'use strict';

var utils = require('./utils');

var UNICODE_BORDER = {
  topLeft: '\u250c',
  topRight: '\u2510',
  bottomLeft: '\u2514',
  bottomRight: '\u2518',
  horizontal: '\u2500',
  vertical: '\u2502',
  topJoin: '\u252c',
  middleLeft: '\u251c',
  middleJoin: '\u253c',
  middleRight: '\u2524',
  bottomJoin: '\u2534',
};

var ASCII_BORDER = {
  topLeft: '+',
  topRight: '+',
  bottomLeft: '+',
  bottomRight: '+',
  horizontal: '-',
  vertical: '|',
  topJoin: '+',
  middleLeft: '+',
  middleJoin: '+',
  middleRight: '+',
  bottomJoin: '+',
};

function cellText(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map(function(row) {
    return Array.isArray(row) ? row : [];
  });
}

function normalizeOptions(options) {
  var opts = options || {};
  var paddingX = opts.paddingX === undefined ? 1 : Number(opts.paddingX);
  var minColumnWidth = opts.minColumnWidth === undefined ? 3 : Number(opts.minColumnWidth);
  return {
    width: Math.max(1, Number(opts.width) || 80),
    alignments: Array.isArray(opts.alignments) ? opts.alignments : [],
    borderStyle: opts.borderStyle === 'ascii' || opts.borderStyle === 'compact' ? opts.borderStyle : 'unicode',
    paddingX: Math.max(0, Number.isFinite(paddingX) ? paddingX : 1),
    minColumnWidth: Math.max(1, Number.isFinite(minColumnWidth) ? minColumnWidth : 3),
    wrapCells: opts.wrapCells !== false,
    fallback: opts.fallback === 'plain' ? 'plain' : 'keyValue',
    annotateRows: Boolean(opts.annotateRows),
  };
}

function emit(output, annotateRows, role, text) {
  output.push(annotateRows ? { role: role, text: text } : text);
}

function splitCellLines(value) {
  var text = cellText(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var lines = text.split('\n').map(function(line) {
    return line.replace(/\t/g, '   ');
  });
  return lines.length ? lines : [''];
}

function columnCount(rows) {
  var count = 0;
  for (var row = 0; row < rows.length; row += 1) {
    count = Math.max(count, rows[row].length);
  }
  return count;
}

function naturalColumnWidths(rows, count, minColumnWidth) {
  var widths = [];
  for (var col = 0; col < count; col += 1) widths[col] = minColumnWidth;
  for (var row = 0; row < rows.length; row += 1) {
    for (var cell = 0; cell < count; cell += 1) {
      var lines = splitCellLines(rows[row][cell]);
      for (var index = 0; index < lines.length; index += 1) {
        widths[cell] = Math.max(widths[cell], utils.visibleWidth(lines[index]));
      }
    }
  }
  return widths;
}

function tableWidth(contentWidths, paddingX) {
  var total = contentWidths.length + 1;
  for (var index = 0; index < contentWidths.length; index += 1) {
    total += contentWidths[index] + paddingX * 2;
  }
  return total;
}

function compressedWidths(contentWidths, options) {
  var widths = contentWidths.slice();
  while (tableWidth(widths, options.paddingX) > options.width) {
    var longest = -1;
    for (var index = 0; index < widths.length; index += 1) {
      if (widths[index] <= options.minColumnWidth) continue;
      if (longest < 0 || widths[index] > widths[longest]) longest = index;
    }
    if (longest < 0) return null;
    widths[longest] -= 1;
  }
  return widths;
}

function padRight(text, width) {
  var missing = Math.max(0, width - utils.visibleWidth(text));
  return text + ' '.repeat(missing);
}

function alignCell(text, width, alignment) {
  var value = utils.truncateToWidth(cellText(text), width);
  var remaining = Math.max(0, width - utils.visibleWidth(value));
  if (alignment === 'right') return ' '.repeat(remaining) + value;
  if (alignment === 'center') {
    var left = Math.floor(remaining / 2);
    return ' '.repeat(left) + value + ' '.repeat(remaining - left);
  }
  return value + ' '.repeat(remaining);
}

function renderCellLines(value, width, wrapCells) {
  if (wrapCells) {
    var wrapped = utils.wrapTextWithAnsi(cellText(value), width);
    return wrapped.length ? wrapped : [''];
  }
  var sourceLines = splitCellLines(value);
  return sourceLines.map(function(line) {
    return utils.truncateToWidth(line, width);
  });
}

function borderLine(left, join, right, horizontal, contentWidths, paddingX) {
  var parts = [];
  for (var index = 0; index < contentWidths.length; index += 1) {
    parts.push(horizontal.repeat(contentWidths[index] + paddingX * 2));
  }
  return left + parts.join(join) + right;
}

function borderChars(style) {
  return style === 'ascii' ? ASCII_BORDER : UNICODE_BORDER;
}

function renderTableRows(rows, contentWidths, options) {
  var output = [];
  var border = borderChars(options.borderStyle);
  var compact = options.borderStyle === 'compact';

  if (!compact) {
    emit(output, options.annotateRows, 'border', borderLine(
      border.topLeft,
      border.topJoin,
      border.topRight,
      border.horizontal,
      contentWidths,
      options.paddingX
    ));
  }

  for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    var wrappedCells = [];
    var rowHeight = 1;
    for (var col = 0; col < contentWidths.length; col += 1) {
      var rendered = renderCellLines(rows[rowIndex][col], contentWidths[col], options.wrapCells);
      if (!rendered.length) rendered = [''];
      wrappedCells[col] = rendered;
      rowHeight = Math.max(rowHeight, rendered.length);
    }

    for (var lineIndex = 0; lineIndex < rowHeight; lineIndex += 1) {
      var line = border.vertical;
      for (var cellIndex = 0; cellIndex < contentWidths.length; cellIndex += 1) {
        var alignment = rowIndex === 0 ? 'left' : options.alignments[cellIndex];
        if (alignment !== 'right' && alignment !== 'center') alignment = 'left';
        var cell = wrappedCells[cellIndex][lineIndex] || '';
        line += ' '.repeat(options.paddingX)
          + alignCell(cell, contentWidths[cellIndex], alignment)
          + ' '.repeat(options.paddingX)
          + border.vertical;
      }
      emit(output, options.annotateRows, rowIndex === 0 ? 'header' : 'body', line);
    }

    if (!compact && rowIndex === 0) {
      emit(output, options.annotateRows, 'border', borderLine(
        border.middleLeft,
        border.middleJoin,
        border.middleRight,
        border.horizontal,
        contentWidths,
        options.paddingX
      ));
    }
  }

  if (!compact) {
    emit(output, options.annotateRows, 'border', borderLine(
      border.bottomLeft,
      border.bottomJoin,
      border.bottomRight,
      border.horizontal,
      contentWidths,
      options.paddingX
    ));
  }

  return output;
}

function pushWrappedFallback(output, options, text) {
  var wrapped = utils.wrapTextWithAnsi(text, options.width);
  if (!wrapped.length) wrapped = [''];
  for (var index = 0; index < wrapped.length; index += 1) {
    emit(output, options.annotateRows, 'fallback', wrapped[index]);
  }
}

function renderPlainFallback(rows, options) {
  var output = [];
  for (var row = 0; row < rows.length; row += 1) {
    pushWrappedFallback(output, options, rows[row].map(cellText).join(' | '));
  }
  return output;
}

function renderKeyValueFallback(rows, options) {
  var output = [];
  var headers = rows[0] || [];
  if (rows.length <= 1) {
    for (var headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
      pushWrappedFallback(output, options, cellText(headers[headerIndex]));
    }
    return output;
  }

  for (var row = 1; row < rows.length; row += 1) {
    var count = Math.max(headers.length, rows[row].length);
    for (var col = 0; col < count; col += 1) {
      var label = cellText(headers[col]) || ('Column ' + (col + 1));
      pushWrappedFallback(output, options, label + ': ' + cellText(rows[row][col]));
    }
    if (row < rows.length - 1) emit(output, options.annotateRows, 'fallback', '');
  }
  return output;
}

function renderFallback(rows, options) {
  return options.fallback === 'plain'
    ? renderPlainFallback(rows, options)
    : renderKeyValueFallback(rows, options);
}

function renderTable(rows, options) {
  var normalizedRows = normalizeRows(rows);
  if (!normalizedRows.length) return [];

  var opts = normalizeOptions(options);
  var count = columnCount(normalizedRows);
  if (count < 2) return renderFallback(normalizedRows, opts);

  var naturalWidths = naturalColumnWidths(normalizedRows, count, opts.minColumnWidth);
  var widths = compressedWidths(naturalWidths, opts);
  if (!widths) return renderFallback(normalizedRows, opts);

  return renderTableRows(normalizedRows, widths, opts);
}

module.exports = {
  renderTable: renderTable,
};
