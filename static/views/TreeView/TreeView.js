/* globals uki, d3 */
import prettyPrintTime from '../../utils/prettyPrintTime.js';
import LinkedMixin from '../common/LinkedMixin.js';

const GLYPHS = {
  CIRCLE: r => `
    M${r},${-r}
    A${r},${r},0,0,0,${r},${r}
    A${r},${r},0,0,0,${r},${-r}
    Z`.replace(/\s/g, ''),
  COLLAPSED_TRIANGLE: r => `
    M0,0
    L${2 * r},${r}
    L0,${2 * r}
    L${r / 2},${r}
    Z`.replace(/\s/g, ''),
  EXPANDED_TRIANGLE: r => `
    M${2 * r},0
    L0,${r}
    L${2 * r},${2 * r}
    L${3 * r / 2},${r}
    Z`.replace(/\s/g, '')
};

class TreeView extends LinkedMixin(uki.ui.SvgGLView) {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push(...[
      { type: 'less', url: 'views/TreeView/style.less' },
      { type: 'text', url: 'views/TreeView/template.html', name: 'template' },
      { type: 'text', url: 'views/TreeView/shapeKey.html' },
      {
        type: 'json',
        url: `/datasets/${options.glState.datasetId}/tree`,
        name: 'tree',
        then: rawTree => d3.hierarchy(rawTree)
      }
    ]);
    super(options);
  }

  get tree () {
    return this.getNamedResource('tree');
  }

  async setup () {
    await super.setup(...arguments);

    this.margin = {
      top: 20,
      right: 20,
      bottom: 20,
      left: 20
    };
    this.legendWidth = 300;
    this.nodeWidth = 50;
    this.wideNodeWidth = 120;
    this.nodeHeight = 20;
    this.nodeSeparation = 1.5; // Factor (not px) for separating nodes vertically
    this.horizontalPadding = 40; // px separation between nodes
    this.mainGlyphRadius = this.nodeHeight / 2;
    this.expanderRadius = 3 * this.mainGlyphRadius / 4;

    this.glEl.classed('TreeView', true);
    this.d3el.html(this.getNamedResource('template'));
    // this.d3el.select('.key').html(this.resources[2]);

    // Redraw when a new primitive is selected
    // TODO: auto-expand and scroll if the selected primitive is collapsed?
    this.linkedState.on('primitiveSelected', () => { this.render(); });

    // Listen for ctrl+f so that all labels are visible when the user is searching
    this.showAllLabels = false;
    const body = d3.select('body');
    body.on('keydown.TreeViewSearchInterceptor', event => {
      // 17, 91 are cmd+ctrl, 13 is enter, 70 is F
      if (event.keyCode === 17 || event.keyCode === 91 || event.keyCode === 92) { // ctrl & cmd
        this.showAllLabels = true;
        this.render();
        body.on('click.TreeViewSearchInterceptor', () => {
          this.showAllLabels = false;
          body.on('click.TreeViewSearchInterceptor', null);
          this.render();
        });
      }
    });
  }

  async draw () {
    await super.draw(...arguments);

    const transition = d3.transition()
      .duration(1000);

    // Compute the new layout
    this.updateLayout(transition);

    // Draw the legend (note: this also sets up this.currentColorTimeScale)
    this.drawLegend();

    // Draw the nodes
    this.drawNodes(transition);

    // Draw the links
    this.drawLinks(transition);

    // Draw any hovered links
    this.drawHoveredLinks(transition);

    // Trash any interaction placeholders now that we've used them
    delete this._expandedParentCoords;
    delete this._collapsedParent;
  }

  updateLayout (transition) {
    // Compute the minimum VERTICAL layout (mbostock's example / the d3 docs are
    // really confusing about this), with fixed node sizes / separation—we'll
    // rotate this later
    const nodeWidth = this.showAllLabels ? this.wideNodeWidth : this.nodeWidth;
    const layoutGenerator = d3.tree()
      .nodeSize([this.nodeHeight, nodeWidth + this.horizontalPadding])
      .separation(() => this.nodeSeparation);
    layoutGenerator(this.tree);
    const xDomain = d3.extent(this.tree.descendants(), d => d.x);
    const yDomain = d3.extent(this.tree.descendants(), d => d.y);

    // Before we mess with sizes, preserve the current scroll position
    const wrapperElement = this.glEl.node();
    const initialScrollPosition = {
      x: wrapperElement.scrollLeft,
      y: wrapperElement.scrollTop
    };

    // Figure out how much space we have to work with (i.e. we want to fill the
    // space if it's more than we need). Temporarily set the SVG to size 0,0 so
    // we can figure out how much space goldenlayout is giving us
    this.d3el.attr('width', 0).attr('height');
    const viewBounds = this.glEl.node().getBoundingClientRect();
    // Now figure out the minimum space we'll need.
    // For each node: we want the x coordinate to correspond to the left
    // coordinate of the node (text will flow right), and the y coordinate to
    // correspond with the center of the node. Also, factor in the margins and
    // some space for scroll bars.
    const xRange = [this.margin.left, Math.max(
      // The minimum right-most coordinate (remember the original domain is rotated)
      this.margin.left + yDomain[1] - yDomain[0],
      // How far over it could be if we use the available screen space
      viewBounds.width - this.scrollBarSize - this.wideNodeWidth - this.margin.right
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
    const resultingSize = {
      width: xRange[1] + this.wideNodeWidth + this.margin.right,
      height: yRange[1] + this.nodeHeight / 2 + this.margin.bottom
    };
    this.d3el
      .attr('width', resultingSize.width)
      .attr('height', resultingSize.height);

    // Restore the scroll position as best we can
    if (initialScrollPosition.x + wrapperElement.clientWidth > resultingSize.width) {
      initialScrollPosition.x = resultingSize.width - wrapperElement.clientWidth;
    }
    wrapperElement.scrollLeft = initialScrollPosition.x;
    if (initialScrollPosition.y + wrapperElement.clientHeight > resultingSize.height) {
      initialScrollPosition.y = resultingSize.height - wrapperElement.clientHeight;
    }
    wrapperElement.scrollTop = initialScrollPosition.y;
  }

  drawLegend () {
    // TODO: need to move the color scale stuff to this.linkedState so that
    // other views can use it
    const colorMap = this.linkedState.timeScaleColors;
    const times = this.tree.descendants()
      .map(d => this.linkedState.getPrimitiveDetails(d.data.name).time)
      .filter(d => d !== undefined);
    if (times.length === 0) {
      return; // No time data; don't bother creating the legend
    }

    // Set the color scale for this function (and the others)
    this.currentColorTimeScale = d3.scaleQuantize()
      .domain(d3.extent(times))
      .range(colorMap);
    // Get the domain windows for each color
    const windows = colorMap.map(d => this.currentColorTimeScale.invertExtent(d));
    const ticks = [windows[0][0]].concat(windows.map(d => d[1]));

    // Create a spatial scale + axis based on the color map
    const axisScale = d3.scaleLinear()
      .domain([ticks[0], ticks[ticks.length - 1]])
      .range([0, this.legendWidth]);
    const axis = d3.axisBottom()
      .scale(axisScale)
      .tickSize(13)
      .tickValues(ticks)
      .tickFormat(d => prettyPrintTime(d));
    // This blows away the previous contents (if any), so we can just deal in
    // .enter() calls from here on
    const g = this.d3el.select('.legend').html('').call(axis);

    // Patch the d3-generated axis
    g.attr('transform', `translate(${this.margin.left},${this.margin.top})`);
    g.select('.domain').remove();
    g.selectAll('rect').data(colorMap)
      .enter()
      .insert('rect', '.tick')
      .attr('height', 8)
      .attr('x', (d, i) => axisScale(windows[i][0]))
      .attr('width', (d, i) => axisScale(windows[i][1]) - axisScale(windows[i][0]))
      .attr('fill', d => d);
  }

  drawNodes (transition) {
    let nodes = this.d3el.select('.nodeLayer').selectAll('.node')
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
    mainGlyphEnter.append('text').classed('unknownValue', true)
      .attr('x', this.mainGlyphRadius)
      .attr('text-anchor', 'middle')
      .attr('y', 3)
      .style('opacity', 0)
      .text('?');
    const mainGlyph = nodes.select('.mainGlyph');
    mainGlyph.selectAll('.area')
      .transition(transition)
      .attr('d', TreeView.GLYPHS.CIRCLE(this.mainGlyphRadius))
      .attr('fill', d => {
        const time = this.linkedState.getPrimitiveDetails(d.data.name).time;
        if (time === undefined) {
          return 'transparent';
        } else {
          return this.currentColorTimeScale(time);
        }
      });
    mainGlyph.selectAll('.outline')
      .transition(transition)
      .attr('d', TreeView.GLYPHS.CIRCLE(1.25 * this.mainGlyphRadius))
      .attr('transform', `translate(${-0.25 * this.mainGlyphRadius})`)
      .style('stroke', d => this.linkedState.selectedPrimitive === d.data.name ? this.linkedState.selectionColor : null);
    mainGlyph.selectAll('.unknownValue')
      .transition(transition)
      .style('opacity', d => {
        return this.linkedState.getPrimitiveDetails(d.data.name).time === undefined ? 1 : 0;
      });

    // Node label
    nodesEnter.append('text')
      .classed('nodeLabel', true)
      .attr('x', 2 * this.mainGlyphRadius)
      .attr('y', this.mainGlyphRadius)
      .text(d => {
        const details = this.linkedState.getPrimitiveDetails(d.data.name);
        // Use display_name if available, but if not (e.g. we only have trace data), use its full name
        return details.display_name || details.name;
      });
    nodes.select('.nodeLabel')
      .attr('opacity', d => {
        return this.showAllLabels || d.data.children.length === 0 ? 1 : 0;
      });

    // Collapse / expand glyph
    const expanderGlyphEnter = nodesEnter.append('g').classed('expander', true)
      .attr('transform', `translate(${2 * this.mainGlyphRadius},${-2 * this.expanderRadius})`);
    expanderGlyphEnter.append('path').classed('area', true);
    expanderGlyphEnter.append('path').classed('outline', true);
    nodes.select('.expander').selectAll('.area, .outline')
      .on('click', (event, d) => {
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
        event.stopPropagation();
      }).transition(transition)
      .attr('d', d => {
        if (d._children) {
          // There are hidden children
          return TreeView.GLYPHS.COLLAPSED_TRIANGLE(this.expanderRadius);
        } else if (!d.children || d.children.length === 0) {
          // No children; this is a leaf
          return null;
        } else {
          // All children are showing
          return TreeView.GLYPHS.EXPANDED_TRIANGLE(this.expanderRadius);
        }
      });

    // Main interactions
    const self = this;
    nodes
      .classed('selected', d => this.linkedState.selectedPrimitive === d.data.name)
      .on('click', (event, d) => {
        this.linkedState.selectPrimitive(d.data.name);
      }).on('mouseenter', function (event, d) {
        const primitive = self.linkedState.getPrimitiveDetails(d.data.name);
        if (!primitive) {
          console.warn(`Can't find primitive of name: ${d.data.name}`);
        } else {
          uki.showTooltip({
            content: d.data.name,
            targetBounds: this.getBoundingClientRect(),
            interactive: false,
            hideAfterMs: 1000,
            anchor: { x: -1, y: -1 } // if there's space, put tooltips above and to the left
          });
          d3.selectAll('.hoveredLinks').filter(hlink => {
            if ((d.x === hlink.x) && (d.y === hlink.y)) {
              return true;
            }
            return false;
          }).style('stroke', '#ffd92f')
            .style('opacity', 0.75);
        }
      }).on('mouseleave', () => {
        d3.selectAll('.hoveredLinks').style('opacity', 0);
      });
  }

  drawLinks (transition) {
    let links = this.d3el.select('.linkLayer').selectAll('.link')
      .data(this.tree.links(), d => d.source.data.name + d.target.data.name);
    const linksEnter = links.enter().append('path').classed('link', true);
    const linksExit = links.exit();
    links = links.merge(linksEnter);

    // Helper function for computing custom paths:
    const computePath = (source, target) => {
      const curveX = target.x - this.horizontalPadding / 2;
      return `\
        M${source.x + 2 * this.mainGlyphRadius},${source.y}\
        L${source.x + this.nodeWidth},${source.y}\
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

  drawHoveredLinks (transition) {
    var state = this.linkedState;
    var allNodes = this.tree.descendants();

    d3.selectAll('.hoveredLinks').remove();

    // Find each node's matches and add the coordinates to the list myMatches
    var allMatches = allNodes.forEach(function (source) {
      source.myMatches = [];
      var startx = source.x;
      var starty = source.y;
      source.myMatches.push({ x: startx, y: starty });

      // Helper function to get important part of the variable/function/primitive's name
      const getImportantName = displayName => {
        var name = '';
        if ((displayName) && (
          (displayName.includes('define-variable')) ||
            (displayName.includes('variable')) ||
            (displayName.includes('access-variable')) ||
            (displayName.includes('access-argument')) ||
            (displayName.includes('access-function')))) {
          name = displayName.split('/')[1].split('(')[0];
        }
        return name;
      };

      if (source.data.name) {
        var importantName = '';
        const displayName = state.getPrimitiveDetails(source.data.name).display_name;
        if (displayName) importantName = getImportantName(displayName);

        // Find the nodes that match my name
        allNodes.forEach(function (dest) {
          var otherImportantName = '';
          const otherDisplayName = state.getPrimitiveDetails(dest.data.name).display_name;
          if (otherDisplayName) otherImportantName = getImportantName(otherDisplayName);

          if (importantName && (importantName == otherImportantName)) {
            var edge_data = { x: dest.x, y: dest.y };
            source.myMatches.push(edge_data);
            source.myMatches.push({ x: startx, y: starty });
          }
        });
      }
      return source.myMatches;
    });

    // Now any source node in allNodes has the attribute source.myMatches
    // console.log(allNodes[3].myMatches);

    const hoveredLinks = this.d3el.select('.nodeLayer').selectAll('.node')
      .data(allNodes, d => d.myMatches);
    const hLinksEnter = hoveredLinks.enter().append('path').classed('hoveredLinks', true);
    const hLinksExit = hoveredLinks.exit();

    // Helper function for computing the paths
    const pathToMatches = listOfCoords => {
      var path = '';
      for (var i = 0; i < listOfCoords.length; i++) {
        if (i % 2 == 1) path += 'L ' + listOfCoords[i].x + ' ' + listOfCoords[i].y + ' ';
        if (i % 2 == 0) path += 'M ' + listOfCoords[i].x + ' ' + listOfCoords[i].y + ' ';
      }
      return path;
    };
    hLinksEnter
      .attr('class', 'hoveredLinks')
      .style('stroke', '#ffd92f')
      .style('stroke-width', '3px')
      .style('opacity', 0)
      .attr('d', link => {
        return pathToMatches(link.myMatches);
      });
  }
}
TreeView.GLYPHS = GLYPHS;

export default TreeView;
