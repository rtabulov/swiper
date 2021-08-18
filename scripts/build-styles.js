/* eslint import/no-extraneous-dependencies: ["error", {"devDependencies": true}] */
/* eslint no-console: "off" */

const fs = require('fs-extra');
const path = require('path');
const globby = require('globby');
const chalk = require('chalk');
const elapsed = require('elapsed-time-logger');
const less = require('./utils/less');
const autoprefixer = require('./utils/autoprefixer');
const minifyCSS = require('./utils/clean-css');
const banner = require('./banner')();
const config = require('./build-config');
const { outputDir } = require('./utils/output-dir');
const { isProd } = require('./utils/env')();

const readSwiperFile = async (filePath) => {
  const fileContent = await fs.readFile(filePath, 'utf-8');
  if (filePath.includes('swiper.less')) {
    const coreContent = fs.readFileSync(path.resolve(__dirname, '../src/core/core.less'), 'utf-8');
    return fileContent
      .replace('//IMPORT_MODULES', '')
      .replace(`@import url('./less/mixins.less');`, '')
      .replace(`@import url('./core/core.less');`, coreContent);
  }
  if (filePath.includes('swiper-vars.less')) {
    return fileContent;
  }
  if (filePath.includes('navigation.less') || filePath.includes('pagination.less')) {
    return ["@import url('../../swiper-vars.less');", fileContent].join('\n\n');
  }
  if (filePath.includes('swiper.scss')) {
    const coreContent = await fs.readFile(
      path.resolve(__dirname, '../src/core/core.scss'),
      'utf-8',
    );
    return fileContent
      .replace(`@import './core/core';`, coreContent)
      .replace('//IMPORT_MODULES', '');
  }
  return fileContent;
};

const buildCSS = async ({ isBundle, modules, minified }) => {
  let lessContent = await fs.readFile(path.resolve(__dirname, '../src/swiper.less'), 'utf8');
  lessContent = lessContent.replace(
    '//IMPORT_MODULES',
    !isBundle
      ? ''
      : modules.map((mod) => `@import url('./modules/${mod}/${mod}.less');`).join('\n'),
  );

  const cssContent = await autoprefixer(
    await less(lessContent, path.resolve(__dirname, '../src')),
  ).catch((err) => {
    throw err;
  });

  const fileName = isBundle ? 'swiper-bundle' : 'swiper';

  // Write file
  await fs.ensureDir(`./${outputDir}`);
  if (isBundle) {
    await fs.writeFile(`./${outputDir}/${fileName}.css`, `${banner}\n${cssContent}`);
  }

  if (minified || !isBundle) {
    const minifiedContent = await minifyCSS(cssContent);
    await fs.writeFile(`./${outputDir}/${fileName}.min.css`, `${banner}\n${minifiedContent}`);
  }
};

module.exports = async () => {
  elapsed.start('styles');
  const modules = config.modules.filter((name) => {
    const lessFilePath = `./src/modules/${name}/${name}.less`;
    return fs.existsSync(lessFilePath);
  });

  buildCSS({ isBundle: true, modules, minified: isProd });
  buildCSS({ isBundle: false, modules, minified: isProd });

  if (isProd) {
    // Copy less & scss
    const files = await globby(
      [
        '**/**.scss',
        '**/**.less',
        '!**/mixins.less',
        '!**/icons/**',
        '!**/angular/**',
        '!**/core/**',
      ],
      {
        cwd: path.resolve(__dirname, '../src'),
      },
    );
    await Promise.all(
      files.map(async (file) => {
        const distFilePath = path.resolve(__dirname, `../${outputDir}`, file);
        const srcFilePath = path.resolve(__dirname, '../src', file);
        const distFileContent = await readSwiperFile(srcFilePath);
        await fs.ensureDir(path.dirname(distFilePath));
        await fs.writeFile(distFilePath, distFileContent);
      }),
    );

    const modulesLessFiles = await globby(['**/**.less'], {
      cwd: path.resolve(__dirname, '../package/modules'),
      absolute: true,
    });
    await Promise.all(
      modulesLessFiles.map(async (filePath) => {
        const fileContent = await fs.readFile(filePath, 'utf-8');

        const content = fileContent.replace('@themeColor', config.themeColor);
        const lessContent = await less(content, path.dirname(filePath)).catch((err) => {
          throw new Error(`${filePath}: ${err}`);
        });
        const resultCSS = await autoprefixer(lessContent);
        const resultFilePath = filePath.replace(/\.less$/, '');
        const minifiedCSS = await minifyCSS(resultCSS);

        // not sure if needed. Possibly can produce a bug cause of the same naming
        // await fs.writeFile(`${resultFilePath}.css`, resultCSS);
        await fs.writeFile(`${resultFilePath}.min.css`, minifiedCSS);
      }),
    );
  }

  elapsed.end('styles', chalk.green('Styles build completed!'));
};
