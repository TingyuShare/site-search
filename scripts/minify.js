#!/usr/bin/env node
/**
 * Minify static files and prepare for deployment to dev branch
 */
const fs = require('fs');
const path = require('path');
const { minify: minifyHtml } = require('html-minifier-terser');
const cssnano = require('cssnano');
const postcss = require('postcss');
const terser = require('terser');

const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, '..');
const DIST_DIR = path.join(SRC_DIR, 'dist')

// Ensure dist directory exists
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

async function minifyJS(file) {
  const code = fs.readFileSync(file, 'utf8');
  const result = await terser.minify(code, {
    compress: true,
    mangle: true,
    output: { comments: false },
  });
  return result.code;
}

async function minifyCSS(file) {
  const code = fs.readFileSync(file, 'utf8');
  const result = await postcss([cssnano]).process(code, { from: undefined });
  return result.css;
}

async function minifyHTML(file) {
  const code = fs.readFileSync(file, 'utf8');
  const result = await minifyHtml(code, {
    collapseWhitespace: true,
    removeComments: true,
    removeEmptyAttributes: true,
    minifyCSS: true,
    minifyJS: true,
  });
  return result;
}

async function build() {
  console.log('🔧 Building static files...');

  // Minify JS
  const jsPath = path.join(SRC_DIR, 'js/app.js');
  if (fs.existsSync(jsPath)) {
    const minified = await minifyJS(jsPath);
    fs.writeFileSync(path.join(DIST_DIR, 'app.min.js'), minified);
    console.log('  ✓ JS minified');
  }

  // Minify CSS
  const cssPath = path.join(SRC_DIR, 'css/style.css');
  if (fs.existsSync(cssPath)) {
    const minified = await minifyCSS(cssPath);
    fs.writeFileSync(path.join(DIST_DIR, 'style.min.css'), minified);
    console.log('  ✓ CSS minified');
  }

  // Minify HTML and update references
  const htmlPath = path.join(SRC_DIR, 'index.html');
  if (fs.existsSync(htmlPath)) {
    let html = await minifyHTML(htmlPath);
    // Update script/style references to minified versions
    html = html.replace(/src="js\/app\.js"/g, 'src="app.min.js"');
    html = html.replace(/href="css\/style\.css"/g, 'href="style.min.css"');
    fs.writeFileSync(path.join(DIST_DIR, 'index.html'), html);
    console.log('  ✓ HTML minified');
  }

  // Copy server.js
  const serverPath = path.join(SRC_DIR, 'server.js');
  if (fs.existsSync(serverPath)) {
    fs.copyFileSync(serverPath, path.join(DIST_DIR, 'server.js'));
    console.log('  ✓ server.js copied');
  }

  console.log('✅ Build complete!');
}

// Run build
build().catch(err => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
