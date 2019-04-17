import nodeResolve from 'rollup-plugin-node-resolve'
import commonjs from 'rollup-plugin-commonjs'
import babel from 'rollup-plugin-babel'
import replace from 'rollup-plugin-replace'
import uglify from 'rollup-plugin-uglify'
import json from 'rollup-plugin-json';

const env = process.env.NODE_ENV
const config = {
  input: 'src/index.js',
  plugins: [json()],
  external: ['fetch'],
  watch: {
    // include and exclude govern which files to watch. by
    // default, all dependencies will be watched
    exclude: ['node_modules/**']
  }
}

if (env === 'es' || env === 'cjs') {
  config.output = { format: env }
  config.external.push('symbol-observable')
  config.plugins.push(
    babel({
      plugins: ['external-helpers'],
    })
  )
}

if (env === 'development' || env === 'production') {
  config.output = { format: 'umd' }
  config.name = 'apiStore'
  config.plugins.push(
    nodeResolve({
      mainFields: 'jsnext',
      browser: true,
    }),
    babel({
      exclude: 'node_modules/**',
      plugins: ['external-helpers'],
    }),
    commonjs(),
    replace({
      'process.env.NODE_ENV': JSON.stringify(env)
    })
  )
}

if (env === 'production') {
  config.plugins.push(
    uglify({
      compress: {
        pure_getters: true,
        unsafe: true,
        unsafe_comps: true,
        warnings: false
      }
    })
  )
}

export default config
