# Stockfish 17.1 (lite, single-threaded, WebAssembly)

These two files are the Stockfish chess engine, compiled to WebAssembly by the
stockfish.js project (https://github.com/nmrugg/stockfish.js, npm package
`stockfish@17.1.0`, files `stockfish-17.1-lite-single-03e3232.js` and `.wasm`,
renamed here). The neural network is embedded in the `.wasm` file.

Stockfish is free software under the GNU General Public License v3 (see
COPYING.txt). Source code: https://github.com/official-stockfish/Stockfish and
https://github.com/nmrugg/stockfish.js.

notlichess runs it in a Web Worker in the visitor's own browser.
