/* globals d3 */

// Borrowing Vega's strategy for hiding overlapping axis labels, adapted to d3 axes
const methods = {
  parity: (label, i) => {
    return i % 2 === 1;
  }
};

export default function cleanupAxis (container, method = 'parity') {
  method = methods[method];
  let hiddenLabels = [];
  let visibleLabels = container.selectAll('.tick text').nodes()
    .map(element => {
      return {
        element,
        bounds: element.getBoundingClientRect()
      };
    });
  const hasOverlap = () => {
    return visibleLabels.some((label, i) => {
      const nextLabel = visibleLabels[i + 1];
      return nextLabel && label.bounds.right >= nextLabel.bounds.left;
    });
  };
  while (visibleLabels.length >= 3 && hasOverlap()) {
    visibleLabels = visibleLabels.filter((label, i) => {
      if (method(label, i)) {
        return true;
      } else {
        hiddenLabels.push(label);
        return false;
      }
    });
  }
  if (visibleLabels.length < 3) {
    // Just keep first and last label
    container.selectAll('.tick text').attr('opacity', 0);
    container.selectAll('.tick:first-child text, .tick:last-child text').attr('opacity', null);
  } else {
    // Hide the ones we identified; restore any that we can
    for (const { element } of hiddenLabels) {
      d3.select(element).attr('opacity', 0);
    }
    for (const { element } of visibleLabels) {
      d3.select(element).attr('opacity', null);
    }
  }
}
