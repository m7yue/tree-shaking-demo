import { a as newa, b } from './a.js';
import { c, d } from './b.js';

const name = '7yue'
let age = 27

const getInfo = () => {
  return {
    name,
    age
  }
}

getInfo()

function unUsedFn() {
  return 'unused'
}

function unUsedFn1() {
  return 'unused'
}

console.log(newa, d);
