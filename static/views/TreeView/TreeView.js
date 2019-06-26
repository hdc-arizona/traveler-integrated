/* globals d3 */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SingleDatasetMixin from '../common/SingleDatasetMixin.js';

class TreeView extends SingleDatasetMixin(GoldenLayoutView) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/TreeView/style.less' },
      { type: 'text', url: 'views/TreeView/template.html' }
    ];
    super(argObj);

    (async () => {
      try {
        this.tree = d3.hierarchy(await d3.json(`/datasets/${encodeURIComponent(this.layoutState.label)}/tree`));
      } catch (err) {
        this.tree = err;
      }
      this.render();
    })();
  }
  get isLoading () {
    return super.isLoading || !this.tree;
  }
  get isEmpty () {
    return this.tree !== undefined && this.tree instanceof Error;
  }
  setup () {
    super.setup();

    this.margin = {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0
    };
    this.nodeWidth = 100;
    this.nodeHeight = 20;
    this.nodeSeparation = 1.5; // Factor (not px) for separating nodes vertically
    this.nodeShapeRadius = 10;

    this.content.html(this.resources[1]);
  }
  draw () {
    super.draw();

    if (this.isHidden || this.isLoading) {
      return; // eslint-disable-line no-useless-return
    } else if (this.histogram instanceof Error) {
      this.emptyStateDiv.html('<p>Error communicating with the server</p>');
    } else {
      // Compute the new layout
      this.updateLayout();

      const transition = d3.transition()
        .duration(300);

      // Draw the nodes
      this.drawNodes(transition);

      // Draw the links
      this.drawLinks(transition);

      // Draw any hovered links
      this.drawHoveredLinks();
    }
  }
  updateLayout () {
    // Compute the minimum VERTICAL layout (mbostock's example / the d3 docs are
    // really confusing about this), with fixed node sizes / separation—we'll
    // rotate this later
    const layoutGenerator = d3.tree()
      .nodeSize([this.nodeHeight, this.nodeWidth])
      .separation(() => this.nodeSeparation);
    layoutGenerator(this.tree);
    const xDomain = d3.extent(this.tree.descendants(), d => d.x);
    const yDomain = d3.extent(this.tree.descendants(), d => d.y);

    // Figure out how much space we have to work with. Here we need to deal with
    // space for each node: we want the x coordinate to correspond to the left
    // coordinate of the node (text will flow right), and the y coordinate to
    // correspond with the center of the node. Also, factor in the
    // scroll bars + margins.
    const viewBounds = this.getAvailableSpace();
    const xRange = [this.margin.left, Math.max(
      // The minimum right-most coordinate (remember the original domain is rotated)
      this.margin.left + yDomain[1] - yDomain[0],
      // How far over it could be if we use the available screen space
      viewBounds.width - this.scrollBarSize - this.nodeWidth - this.margin.right
    )];
    const yRange = [this.margin.top + this.nodeHeight / 2, Math.max(
      // The minimum bottom-most coordinate (remember the original domain is rotated)
      this.margin.top + this.nodeHeight / 2 + xDomain[1] - xDomain[0],
      // How far down it could be if we use the available screen space
      viewBounds.height - this.scrollBarSize - this.nodeHeight / 2 - this.margin.bottom
    )];

    // Update the coordinates
    const yToX = d3.scaleLinear().domain(yDomain).range(xRange);
    const xToY = d3.scaleLinear().domain(xDomain).range(yRange);
    for (const node of this.tree.descendants()) {
      const temp = node.x;
      node.x = yToX(node.y);
      node.y = xToY(temp);
    }

    // Resize our SVG element to the needed size
    this.content.select('svg.tree')
      .attr('width', xRange[1] + this.nodeWidth + this.margin.right)
      .attr('height', yRange[1] + this.nodeHeight / 2 + this.margin.bottom);
  }
  drawNodes (transition) {
    let nodes = this.content.select('.nodeLayer').selectAll('.node')
      .data(this.tree.descendants(), d => d.data.name);
    const nodesExit = nodes.exit();
    const nodesEnter = nodes.enter().append('g').classed('node', true);
    nodes = nodes.merge(nodesEnter);

    nodesEnter.append('path').classed('area', true);
    nodesEnter.append('path').classed('outline', true);

    // Start new nodes at their parents' old coordinates (or their native
    // coordinates if this is the first draw)
    nodesEnter.attr('transform', d => `translate(${d.x0 || d.x},${d.y0 || d.y})`);
    // Move all new + existing nodes to their target coordinates
    nodes.transition(transition)
      .attr('transform', d => `translate(${d.x},${d.y})`);
    // Move old nodes to their parents' new coordinates, and then remove them
    nodesExit.transition(transition)
      .attr('transform', d => `translate(${d.parent.x}, ${d.parent.y})`)
      .remove();

    // Node shapes (horizontally left-aligned, vertically center-aligned)
    const triangle = `\
M$0,${-this.nodeShapeRadius}\
L${2 * this.nodeShapeRadius},0\
L0,${this.nodeShapeRadius}\
Z`;
    const circle = `\
M${this.nodeShapeRadius},${-this.nodeShapeRadius}\
A${this.nodeShapeRadius},${this.nodeShapeRadius},0,0,0,${this.nodeShapeRadius},${this.nodeShapeRadius}\
A${this.nodeShapeRadius},${this.nodeShapeRadius},0,0,0,${this.nodeShapeRadius},${-this.nodeShapeRadius}\
Z`;
    nodes.selectAll('.area, .outline')
      .transition(transition)
      .attr('d', d => d._children ? triangle : circle);
  }
  drawLinks (transition) {
    // TODO
  }
  drawHoveredLinks () {
    // TODO
  }
}
export default TreeView;
