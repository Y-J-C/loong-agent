'use strict';

function isFocusable(component) {
  return Boolean(component && Object.prototype.hasOwnProperty.call(component, 'focused'));
}

module.exports = {
  isFocusable: isFocusable,
};
