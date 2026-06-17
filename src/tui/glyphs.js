'use strict';

const GLYPHS = {
  hline: '─',
  selector: '› ',
  unselected: '  ',
  cursor: '█',
  bullet: '- ',
  quote: '│ ',
  toolTop: '╭─',
  toolMid: '│ ',
  toolBottom: '╰─',
};

function hline(width) {
  return GLYPHS.hline.repeat(Math.max(1, width || 1));
}

module.exports = {
  GLYPHS,
  hline,
};
