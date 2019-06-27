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
    this.nodeWidth = 120;
    this.nodeHeight = 20;
    this.nodeSeparation = 1.5; // Factor (not px) for separating nodes vertically
    this.horizontalPadding = 40; // px separation between nodes
    this.nodeShapeRadius = 10;

    // Custom shapes based on these measurements:
    this.glyphs = {
      collapsedTriangle: `\
M${-2 * this.nodeShapeRadius},${-this.nodeShapeRadius}\
L0,0\
L${-2 * this.nodeShapeRadius},${this.nodeShapeRadius}\
Z`,
      expandedTriangle: `\
M${-2 * this.nodeShapeRadius},0\
L0,${-this.nodeShapeRadius}\
L0,${this.nodeShapeRadius}\
Z`,
      circle: `\
M${this.nodeShapeRadius},${-this.nodeShapeRadius}\
A${this.nodeShapeRadius},${this.nodeShapeRadius},0,0,0,${this.nodeShapeRadius},${this.nodeShapeRadius}\
A${this.nodeShapeRadius},${this.nodeShapeRadius},0,0,0,${this.nodeShapeRadius},${-this.nodeShapeRadius}\
Z`
    };

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
        .duration(1000);

      // Draw the nodes
      this.drawNodes(transition);

      // Draw the links
      this.drawLinks(transition);

      // Draw any hovered links
      this.drawHoveredLinks();

      // Trash any interaction placeholders now that we've used them
      delete this._expandedParentCoords;
      delete this._collapsedParent;
    }
  }
  updateLayout () {
    // Compute the minimum VERTICAL layout (mbostock's example / the d3 docs are
    // really confusing about this), with fixed node sizes / separation—we'll
    // rotate this later
    const layoutGenerator = d3.tree()
      .nodeSize([this.nodeHeight, this.nodeWidth + this.horizontalPadding])
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
    const nodesEnter = nodes.enter().append('g').classed('node', true);
    const nodesExit = nodes.exit();
    nodes = nodes.merge(nodesEnter);

    // Start new nodes at their parents' old coordinates (or their native
    // coordinates if this is the first draw)
    nodesEnter.attr('transform', d => {
      if (this._expandedParentCoords) {
        return `translate(${this._expandedParentCoords.x + this.nodeWidth},${this._expandedParentCoords.y})`;
      } else {
        return `translate(${d.x},${d.y})`;
      }
    }).attr('opacity', 0);
    // Move old nodes to clicked node's new coordinates, and then remove them
    nodesExit.transition(transition)
      .attr('transform', d => {
        if (this._collapsedParent) {
          return `translate(${this._collapsedParent.x + this.nodeWidth},${this._collapsedParent.y})`;
        } else {
          return `translate(${d.parent.x + this.nodeWidth}, ${d.parent.y})`;
        }
      })
      .attr('opacity', 0)
      .remove();
    // Move all new + existing nodes to their target coordinates
    nodes.transition(transition)
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .attr('opacity', 1);

    // Main glyph (just circles for now)
    const mainGlyphEnter = nodesEnter.append('g').classed('mainGlyph', true);
    mainGlyphEnter.append('path').classed('area', true);
    mainGlyphEnter.append('path').classed('outline', true);
    nodes.select('.mainGlyph').selectAll('.area, .outline')
      .transition(transition)
      .attr('d', this.glyphs.circle);

    // Node label
    nodesEnter.append('text')
      .attr('x', 2 * this.nodeShapeRadius)
      .text(d => this.linkedState.getPrimitiveDetails(d.data.name).name);

    // Collapse / expand glyph
    const expanderGlyphEnter = nodesEnter.append('g').classed('expander', true)
      .attr('transform', `translate(${this.nodeWidth},0)`);
    expanderGlyphEnter.append('path').classed('area', true);
    expanderGlyphEnter.append('path').classed('outline', true);
    nodes.select('.expander').selectAll('.area, .outline')
      .on('click', d => {
        // Hide / show the children
        if (d._children) {
          d.children = d._children;
          delete d._children;
          // New child animations need to start growing from this old parent
          // coordinate
          this._expandedParentCoords = { x: d.x, y: d.y };
        } else {
          d._children = d.children;
          delete d.children;
          // Old child animations need to end at this parent, but at its new
          // coordinates (so just keep track of which parent; its coordinates
          // will get updated later by updateLayout)
          this._collapsedParent = d;
        }
        this.render();
      }).transition(transition)
      .attr('d', d => {
        if (d._children) {
          // There are hidden children
          return this.glyphs.collapsedTriangle;
        } else if (!d.children || d.children.length === 0) {
          // No children; this is a leaf
          return null;
        } else {
          // All children are showing
          return this.glyphs.expandedTriangle;
        }
      });
  }
  drawLinks (transition) {
    let links = this.content.select('.linkLayer').selectAll('.link')
      .data(this.tree.links(), d => d.source.data.name + d.target.data.name);
    const linksEnter = links.enter().append('path').classed('link', true);
    const linksExit = links.exit();
    links = links.merge(linksEnter);

    // Helper function for computing custom paths:
    const computePath = (source, target) => {
      const curveX = target.x - this.horizontalPadding / 2;
      return `\
M${source.x + 2 * this.nodeShapeRadius},${source.y}\
L${source.x + this.nodeWidth - 2 * this.nodeShapeRadius},${source.y}\
M${source.x + this.nodeWidth},${source.y}\
C${curveX},${source.y},${curveX},${target.y},${target.x},${target.y}`;
    };
    linksEnter
      .attr('opacity', 0)
      .attr('d', link => {
        // Start new links at the end of the old clicked target if it exists, or
        // the end of the parent if this is the first draw
        if (this._expandedParentCoords) {
          return computePath(this._expandedParentCoords, this._expandedParentCoords);
        } else {
          return computePath(link.source, {
            x: link.source.x + this.nodeWidth,
            y: link.source.y
          });
        }
      });
    linksExit.transition(transition)
      .attr('opacity', 0)
      .attr('d', link => {
        // End old links at the end of the parent's new coordinates
        return computePath(this._collapsedParent || link.source, this._collapsedParent || link.source);
      })
      .remove();
    links.transition(transition)
      .attr('opacity', 1)
      .attr('d', link => {
        // Animate to the correct locations
        return computePath(link.source, link.target);
      });
  }
  drawHoveredLinks () {
    // TODO
  }
}
export default TreeView;
