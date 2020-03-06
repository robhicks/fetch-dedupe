import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import { uglify } from 'rollup-plugin-uglify';
import pkg from './package.json';

// eslint-disable-next-line
const prod = !process.env.ROLLUP_WATCH;

export default {
  input: 'src/FetchDedupe.js',
  plugins: [ resolve(), commonjs(), prod && terser()],
  output: [
    { file: pkg.main, format: 'cjs' },
    { file: pkg.browser, format: 'umd', name: 'FetchDedupe' }
  ]
}
