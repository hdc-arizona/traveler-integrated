/* globals uki, d3 */
import prettyPrintTime from '../../utils/prettyPrintTime.js';
import LinkedMixin from '../common/LinkedMixin.js';

const GLYPHS = {
  CIRCLE: r => `
    M${r},${-r}
    A${r},${r},0,0,0,${r},${r}
    A${r},${r},0,0,0,${r},${-r}
    Z`.replace(/\s/g, ''),
  DIAMOND: r => {
    // Keep diamond area the same as the circle,
    // but center on the original radius
    const r2 = r * Math.sqrt(Math.PI / 2);
    return `
      M${r - r2},0
      L${r},${-r2}
      L${r + r2},0
      L${r},${r2}
      Z`.replace(/\s/g, '');
  },
  SQUARE: r => {
    // Keep square area the same as the circle,
    // but center on the original radius
    const r2 = r * Math.sqrt(Math.PI) / 2;
    return `
      M${r - r2},${-r2}
      L${r + r2},${-r2}
      L${r + r2},${r2}
      L${r - r2},${r2}
      Z`.replace(/\s/g, '');
  },
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

function evalTypeGlyph (evalCode, radius) {
  switch (evalCode) {
    // Undecided
    case -1: return GLYPHS.CIRCLE(radius);
    // Asynchronous
    case 0: return GLYPHS.DIAMOND(radius);
    // Synchronous
    case 1: return GLYPHS.SQUARE(radius);
    // Missing data; still use the circle for the outline
    default: return GLYPHS.CIRCLE(radius);
  }
}

class DependencyTreeView extends LinkedMixin( // Ensures that this.linkedState is updated through app-wide things like Controller.refreshDatasets()
  uki.ui.SvgGLView) { // Ensures this.d3el is an SVG element; adds the download icon to the tab
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push(...[
      { type: 'less', url: 'views/DependencyTreeView/style.less' },
      { type: 'text', url: 'views/DependencyTreeView/template.html', name: 'template' },
      { type: 'text', url: 'views/DependencyTreeView/shapeKey.html' },
      {
        type: 'json',
        url: `/datasets/${options.glState.datasetId}/getDependencyTree?intervalId=3843`,
        // 3843 cannon
        // 468 3849
        // 3497 load_component_action`
        // 0 run_helper
        name: 'tree',
        then: rawTree => {
          const tree = d3.hierarchy(rawTree);
          // Attach details about each primitive to each tree node
          tree.each(node => {
            node.details = node.data.name;//this.linkedState.getPrimitiveDetails(node.data.name);
          });
          // Now that we have details, compute exclusive times
          tree.each(node => {
            if (node.details.time !== undefined) {
              node.details.exclusiveTime = 10;//node.details.time;
              // for (const childNode of node.children || []) {
              //   if (childNode.details.time !== undefined) {
              //     node.details.exclusiveTime -= childNode.details.time;
              //   }
              // }
            }
          });
          return tree;
        }
      }
    ]);
    super(options);

    // In addition to the listeners that LinkedMixin provides, DependencyTreeView should
    // also redraw itself when the colorMode changes
    this.linkedState.on('colorModeChanged', () => { this.render(); });
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
    this.legendHeight = 60;
    this.nodeWidth = 50;
    this.wideNodeWidth = 120;
    this.nodeHeight = 20;
    this.nodeSeparation = 1.5; // Factor (not px) for separating nodes vertically
    this.horizontalPadding = 40; // px separation between nodes
    this.mainGlyphRadius = this.nodeHeight / 2;
    this.expanderRadius = 3 * this.mainGlyphRadius / 4;

    this.glEl.classed('DependencyTreeView', true);
    this.d3el.html(this.getNamedResource('template'));
    this.initKey();

    // Listen for ctrl+f so that all labels are visible when the user is searching
    this.showAllLabels = false;
    const body = d3.select('body');
    body.on('keydown.DependencyTreeViewSearchInterceptor', event => {
      // 17, 91 are cmd+ctrl, 13 is enter, 70 is F
      if (event.keyCode === 17 || event.keyCode === 91 || event.keyCode === 92) { // ctrl & cmd
        this.showAllLabels = true;
        this.render();
        body.on('click.DependencyTreeViewSearchInterceptor', () => {
          this.showAllLabels = false;
          body.on('click.DependencyTreeViewSearchInterceptor', null);
          this.render();
        });
      }
    });
  }

  initKey () {
    const self = this;
    const r = 0.75 * self.mainGlyphRadius;
    this.d3el.selectAll('[data-eval-type]').each(function () {
      d3.select(this.parentNode)
        .attr('height', 3 * r)
        .attr('width', 3 * r);
      d3.select(this)
        .attr('d', evalTypeGlyph(parseInt(this.dataset.evalType), r))
        .attr('transform', `translate(${0.5 * r},${1.5 * r})`);
    });
  }

  async draw () {
    await super.draw(...arguments);

    if (this.isLoading) {
      // Don't draw anything if we're still waiting on something; super.draw
      // will show a spinner. Instead, ensure that another render() call is
      // fired when we're finally ready
      this.ready.then(() => { this.render(); });
      return;
    } else if (this.error) {
      // If there's an upstream error, super.draw will already display an error
      // message. Don't attempt to draw anything (or we'll probably just add to
      // the noise of whatever is really wrong)
      return;
    }

    const transition = d3.transition()
      .duration(1000);

    // Figure out how big the SVG should be, and compute node positions
    const nodeList = this.computeLayout(transition);

    // Draw the legend (also sets up this.currentColorTimeScale)
    this.drawLegend(nodeList);

    // Draw the nodes
    this.drawNodes(transition, nodeList);

    // Draw the links
    this.drawLinks(transition);

    // Draw the extra (shown-on-hover-only) links
    this.drawExtraLinks(nodeList);

    // Trash any interaction placeholders now that we've used them
    delete this._expandedParentCoords;
    delete this._collapsedParent;
  }

  computeLayout (transition) {
    // Compute the minimum VERTICAL layout (mbostock's example / the d3 docs are
    // really confusing about this), with fixed node sizes / separation—we'll
    // rotate this later
    const nodeWidth = this.showAllLabels ? this.wideNodeWidth : this.nodeWidth;
    const layoutGenerator = d3.tree()
      .nodeSize([this.nodeHeight, nodeWidth + this.horizontalPadding])
      .separation(() => this.nodeSeparation);
    layoutGenerator(this.tree);

    // Get where each node wants to be based on the minimum layout; we'll
    // update later if we have more space
    const nodeList = this.tree.descendants();

    const xDomain = d3.extent(nodeList, d => d.x);
    const yDomain = d3.extent(nodeList, d => d.y);

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
    const yRange = [this.margin.top + this.legendHeight + this.nodeHeight / 2, Math.max(
      // The minimum bottom-most coordinate (remember the original domain is rotated)
      this.margin.top + this.legendHeight + this.nodeHeight / 2 + xDomain[1] - xDomain[0],
      // How far down it could be if we use the available screen space
      viewBounds.height - this.scrollBarSize - this.nodeHeight / 2 - this.margin.bottom
    )];

    // Update the coordinates for each node now that we know how much space we
    // can use
    const yToX = d3.scaleLinear().domain(yDomain).range(xRange);
    const xToY = d3.scaleLinear().domain(xDomain).range(yRange);
    for (const node of nodeList) {
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

    return nodeList;
  }

  drawLegend (nodeList) {
    // TODO: need to move the color scale stuff to this.linkedState so that
    // other views can use it
    const colorMap = this.linkedState.timeScaleColors;
    const times = nodeList
      .map(d => this.linkedState.colorMode === 'inclusive'
        ? d.details.time
        : d.details.exclusiveTime)
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

    // Update the radio buttons below the legend
    const self = this;
    this.d3el.select('.key')
      .attr('x', this.margin.left)
      .attr('width', this.legendWidth)
      .selectAll('input')
      .on('change.colorModeToggle', function () {
        self.linkedState.colorMode = this.dataset.mode;
      }).each(function () {
        this.checked = this.dataset.mode === self.linkedState.colorMode;
      });
  }

  drawNodes (transition, nodeList) {
    let nodes = this.d3el.select('.nodeLayer').selectAll('.node')
      .data(nodeList, d => d.data.name);
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
    nodes.classed('selected', d => d.data.name === this.linkedState.selection?.primitiveName);

    // Main glyph
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
      .attr('d', d => evalTypeGlyph(d.details.eval_direct, this.mainGlyphRadius))
      .attr('fill', d => d.details.time === undefined
        ? 'transparent'
        : this.currentColorTimeScale(this.linkedState.colorMode === 'inclusive'
          ? d.details.time
          : d.details.exclusiveTime));
    mainGlyph.selectAll('.outline')
      .transition(transition)
      .attr('d', d => evalTypeGlyph(d.details.eval_direct, 1.25 * this.mainGlyphRadius))
      .attr('transform', `translate(${-0.25 * this.mainGlyphRadius})`);
    mainGlyph.selectAll('.unknownValue')
      .transition(transition)
      .style('opacity', d => {
        return d.details.time === undefined ? 1 : 0;
      });

    // Node label
    nodesEnter.append('text')
      .classed('nodeLabel', true)
      .attr('x', 2 * this.mainGlyphRadius)
      .attr('y', this.mainGlyphRadius)
      .text(d => {
        // Use display_name if available, but if not (e.g. we only have trace data), use its full name
        return d.details.display_name || d.data.name;
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
          return DependencyTreeView.GLYPHS.COLLAPSED_TRIANGLE(this.expanderRadius);
        } else if (!d.children || d.children.length === 0) {
          // No children; this is a leaf
          return null;
        } else {
          // All children are showing
          return DependencyTreeView.GLYPHS.EXPANDED_TRIANGLE(this.expanderRadius);
        }
      });

    // Main interactions
    const self = this;
    nodes
      .on('click', (event, d) => {
        if (this.linkedState.selection?.primitiveName === d.data.name) {
          // Deselect
          this.linkedState.selection = null;
        } else {
          // let primitivesStack = [d];
          // let primitives = [];
          // let currentNode = primitivesStack.pop();
          // while(currentNode) {
          //   primitives.push(currentNode.data.name);
          //   if(currentNode.children !== undefined) {
          //     for(const eachNode of currentNode.children) {
          //       primitivesStack.push(eachNode);
          //     }
          //   }
          //   currentNode = primitivesStack.pop();
          // }
          this.linkedState.selectPrimitive(d.data.name);
        }
      }).on('mouseenter', function (event, d) {
        const label = d.details.display_name || d.data.name;
        let time = self.linkedState.colorMode === 'inclusive'
          ? d.details?.time
          : d.details?.exclusiveTime;
        if (time === undefined) {
          time = '(no time data)';
        } else {
          time = prettyPrintTime(time);
        }
        uki.showTooltip({
          content: `${label}: ${time}`,
          targetBounds: this.getBoundingClientRect(),
          interactive: false,
          hideAfterMs: 1000,
          anchor: { x: -1, y: -1 } // if there's space, put tooltips above and to the left
        });
        d3.select('.extraLinkLayer').selectAll('.link')
          .classed('hovered', link => {
            return link.source.data.name === d.data.name ||
              link.target.data.name === d.data.name;
          });
      }).on('mouseleave', () => {
        d3.select('.extraLinkLayer').selectAll('.link')
          .classed('hovered', false);
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
        C${curveX},${source.y},${curveX},${target.y},${target.x},${target.y}`
        .replace(/\s/g, '');
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

  drawExtraLinks (nodeList) {
    // Create links based on common references to variables
    const allMatches = {};
    const linkList = [];
    const variableNameMatcher = /(?:(?:variable)|(?:access-argument)|(?:access-function))\/([^(]*)\(/;
    for (const node of nodeList) {
      const referencedVariable = node.details.display_name?.match(variableNameMatcher)?.[1];
      if (referencedVariable) {
        allMatches[referencedVariable] = allMatches[referencedVariable] || [];
        // Add this reference, and any links to any other references
        for (const priorReferenceNode of allMatches[referencedVariable]) {
          linkList.push({
            source: node,
            target: priorReferenceNode
          });
        }
        allMatches[referencedVariable].push(node);
      }
    }

    let links = this.d3el.select('.extraLinkLayer').selectAll('.link')
      .data(linkList, d => d.source.data.name + d.target.data.name);
    const linksEnter = links.enter().append('path').classed('link', true);
    links.exit().remove();
    links = links.merge(linksEnter);

    // Helper function for computing custom paths:
    const computePath = (source, target) => {
      return `\
        M${source.x + this.mainGlyphRadius},${source.y}\
        L${target.x + this.mainGlyphRadius},${target.y}`
        .replace(/\s/g, '');
    };
    links.classed('hovered', false)
      .attr('d', link => {
        // Animate to the correct locations
        return computePath(link.source, link.target);
      });
  }
}
DependencyTreeView.GLYPHS = GLYPHS;

export default DependencyTreeView;
