// The chess core (move rules from index.html, SAN/motifs/classifier from src/js) in a Node sandbox.
const fs = require('fs'), path = require('path');
const H = require('./harness');
const SRC = path.join(__dirname, '..', 'src', 'js');
const CORE = ['03-core-san.js', '04-core-motifs.js', '05-core-classify.js'];
const BOARD = ['KNIGHT_D', 'BISHOP_D', 'ROOK_D', 'PIECE_VAL', 'chessStart', 'sqOk', 'isW', 'squareAttacked', 'kingSq',
  'leavesCheck', 'pseudoReaches', 'sanApply', 'checkedKingSq', 'stateFen', 'cloneState', 'legalMoves', 'applyMove',
  'stateAtPly', 'uciToMove'];
module.exports = H.load(BOARD, { extraCode: CORE.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n') });
