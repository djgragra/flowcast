'use strict';
// Rename and delete categories. A category is the text in a show's "category" field, so both
// operations rewrite the shows that use it and move the colour the user chose for it.
const categoryOf = show => String((show && show.category) || '').trim();

// Shows (copies) that change, and the new colours map.
// If `to` is already a category the two are merged and the shows keep the colour of `to`.
function renameCategory(shows, colors, from, to) {
  from = String(from || '').trim();
  to   = String(to   || '').trim();
  const out = { changed: [], colors: { ...(colors || {}) }, merged: false };
  if (!from || !to || from === to) return out;
  out.merged = shows.some(s => categoryOf(s) === to);
  out.changed = shows.filter(s => categoryOf(s) === from).map(s => ({ ...s, category: to }));
  if (from in out.colors) {
    if (!(to in out.colors)) out.colors[to] = out.colors[from];
    delete out.colors[from];
  }
  return out;
}

// moveTo: another category, or '' for "no category". Deleting never leaves a show behind.
function deleteCategory(shows, colors, name, moveTo) {
  name   = String(name   || '').trim();
  moveTo = String(moveTo || '').trim();
  const out = { changed: [], colors: { ...(colors || {}) } };
  if (!name || moveTo === name) return out;
  out.changed = shows.filter(s => categoryOf(s) === name).map(s => ({ ...s, category: moveTo }));
  delete out.colors[name];
  return out;
}

module.exports = { categoryOf, renameCategory, deleteCategory };
