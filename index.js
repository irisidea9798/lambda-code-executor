// import { NodeVM } from 'vm2';
// import axios from 'axios';
// import fetch from 'node-fetch';
// import * as graphlib from 'graphlib';
// import dijkstra from 'dijkstrajs';


// export const handler = async (event) => {
//   try {
//     const body = JSON.parse(event.body || '{}');
//     const userCode = body.code;

//     if (!userCode || userCode.length > 100000) {
//       return {
//         statusCode: 413,
//         body: JSON.stringify({ error: 'Code too large. Max 100 KB allowed.' }),
//       };
//     }

//     if (/while\s*\(true\)|for\s*\(\s*;\s*;\s*\)/.test(userCode)) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({ error: 'Infinite loop patterns are not allowed.' }),
//       };
//     }
//     if (/require\(['"`](fs|os|path|child_process|vm|module)['"`]\)/.test(userCode)) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({ error: 'Access to core Node modules is not allowed.' }),
//       };
//     }
//     const vm = new NodeVM({
//       console: 'inherit',
//       sandbox: {
//         fetch,
//         axios,
//         graphlib,
//         dijkstra,
//         URL,
//         crypto: globalThis.crypto,
//         setTimeout,
//         setInterval,
//         clearTimeout,
//         clearInterval,
//         Buffer,
//         process:undefined,
//       },
//       timeout: 1000,
//       eval: false,
//       wasm: false,
//       require: {
//         external: true,
//         builtin: [],
//       },
//     });

//     const wrappedCode = `
//       module.exports = async () => {
//         ${userCode}
//       }
//     `;

//     const scriptFunc = vm.run(wrappedCode, 'user-code.js');
    
//     const maxExecutionTime = 3000; 

//     const result = await Promise.race([
//       scriptFunc(),
//       new Promise((_, reject) =>
//         setTimeout(() => reject(new Error('Execution timed out')), maxExecutionTime)
//       ),
//     ]);



//     if (result?.__error) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({
//           error: result.message,
//           ...(isDev && { stack: result.stack }), // return stack trace only in dev
//         }),
//       };
//     }

//     return {
//       statusCode: 200,
//       body: JSON.stringify({ result }),
//     };
//   } catch (error) {
//     console.error('Execution Error:', error);
//     return {
//       statusCode: 500,
//       body: JSON.stringify({ error: error.message }),
//     };
//   }
// };

import { NodeVM } from 'vm2';
import * as graphlib from 'graphlib';
import { JSDOM } from 'jsdom';
import * as d3 from 'd3';

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const userCode = body.code;

    // Input validation
    if (!userCode || userCode.length > 100000) {
      return {
        statusCode: 413,
        body: JSON.stringify({ error: 'Code too large. Max 100 KB allowed.' }),
      };
    }

    if (/while\s*\(true\)|for\s*\(\s*;\s*;\s*\)/.test(userCode)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Infinite loop patterns are not allowed.' }),
      };
    }

    if (/require\(['"`](fs|os|path|child_process|vm|module)['"`]\)/.test(userCode)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Access to core Node modules is not allowed.' }),
      };
    }

    // Configure VM with allowed modules
    const vm = new NodeVM({
      console: 'inherit',
      sandbox: {
        graphlib,
        URL,
        crypto: globalThis.crypto,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        Buffer,
        process: undefined,
      },
      timeout: 1000,
      eval: false,
      wasm: false,
      require: {
        external: false,
        builtin: [],
      },
    });

    const wrappedCode = `
      module.exports = async () => {
        ${userCode}
      }
    `;

    // Execute user code
    const scriptFunc = vm.run(wrappedCode, 'user-code.js');
    const maxExecutionTime = 3000;
    const result = await Promise.race([
      scriptFunc(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Execution timed out')), maxExecutionTime)
      ),
    ]);

    // Handle errors from user code
    if (result?.__error) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: result.message,
        }),
      };
    }

    // Generate visualization if it's a graph
    let visualization = null;
    if (result && result instanceof graphlib.Graph) {
      visualization = await generateGraphSvg(result);
    }else if (isBarChartData(result)) {
      visualization = await generateBarChartSvg(result);
    }else if (isPieChartData(result)) {
      visualization = await generatePieChartSvg(result);
    }else if (isLinePlotData(result)) {
      visualization = await generateLinePlotSvg(result);
    }

  

    // Prepare response
    const response = {
      result: serializeGraph(result),
      ...(visualization && { visualization })
    };

    return {
      statusCode: 200,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Execution Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

function isBarChartData(data) {
  return data?.labels && data?.values && Array.isArray(data.labels) && Array.isArray(data.values);
}
function isPieChartData(data) {
  return data?.labels && data?.sizes && Array.isArray(data.labels) && Array.isArray(data.sizes);
}
function isLinePlotData(data) {
  return data?.x && data?.y && Array.isArray(data.x) && Array.isArray(data.y);
}

// Helper to serialize graph data
function serializeGraph(graph) {
  if (!graph || !(graph instanceof graphlib.Graph)) return graph;
  
  return {
    nodes: graph.nodes(),
    edges: graph.edges(),
    isDirected: graph.isDirected(),
    isMultigraph: graph.isMultigraph(),
    isCompound: graph.isCompound()
  };
}


async function generateGraphSvg(graph) {
  // Create a minimal DOM environment without browser-specific APIs
  const { window } = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
    pretendToBeVisual: true,
    runScripts: "dangerously",
    resources: "usable",
    beforeParse(window) {
      // Mock missing browser APIs that D3 might need
      window.navigator = {
        userAgent: 'Node.js/JSDOM',
        platform: 'Linux'
      };
      window.requestAnimationFrame = (callback) => {
        return setTimeout(callback, 0);
      };
      window.cancelAnimationFrame = (id) => {
        clearTimeout(id);
      };
    }
  });

  const document = window.document;
  const width = 800, height = 600;

  const svg = d3.select(document.body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  // Prepare graph data
  const nodes = graph.nodes().map(id => ({ id }));
  const links = graph.edges().map(edge => ({
    source: edge.v,
    target: edge.w,
    ...(edge.name && { name: edge.name })
  }));

  // Create simulation (simplified without interactivity)
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2));

  // Draw links
  const link = svg.append('g')
    .selectAll('line')
    .data(links)
    .enter().append('line')
    .attr('stroke', '#999')
    .attr('stroke-width', 2);

  // For directed graphs, add arrow markers
  if (graph.isDirected()) {
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 15)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#999');

    link.attr('marker-end', 'url(#arrowhead)');
  }

  // Draw nodes
  const node = svg.append('g')
    .selectAll('g')
    .data(nodes)
    .enter().append('g');

  node.append('circle')
    .attr('r', 10)
    .attr('fill', '#69b3a2');

  node.append('text')
    .attr('dx', 12)
    .attr('dy', '.35em')
    .text(d => d.id);

  // Run the simulation to completion
  return new Promise((resolve) => {
    simulation.stop(); // Stop any automatic animation
    simulation.tick(300); // Run the simulation for 300 iterations
    
    // Update final positions
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node.attr('transform', d => `translate(${d.x},${d.y})`);

    resolve(svg.node().outerHTML);
  });
}

async function generateBarChartSvg(data) {
  const { window } = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);
  const document = window.document;

  // Chart dimensions
  const width = 800, height = 500;
  const margin = { top: 30, right: 30, bottom: 70, left: 60 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Create SVG
  const svg = d3.select(document.body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // X-axis (band scale for categories)
  const x = d3.scaleBand()
    .domain(data.labels)
    .range([0, innerWidth])
    .padding(0.2);

  svg.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x))
    .selectAll('text')
    .attr('transform', 'rotate(-45)')
    .style('text-anchor', 'end');

  // Y-axis (linear scale for values)
  const y = d3.scaleLinear()
    .domain([0, d3.max(data.values)])
    .range([innerHeight, 0]);

  svg.append('g')
    .call(d3.axisLeft(y));

  // Draw bars
  svg.selectAll('rect')
    .data(data.labels.map((label, i) => ({ label, value: data.values[i] })))
    .enter()
    .append('rect')
    .attr('x', d => x(d.label))
    .attr('y', d => y(d.value))
    .attr('width', x.bandwidth())
    .attr('height', d => innerHeight - y(d.value))
    .attr('fill', '#69b3a2');

  return svg.node().parentNode.outerHTML;
}
async function generatePieChartSvg(data) {
  const { window } = new JSDOM(`<!DOCTYPE html>`);
  const document = window.document;

  const width = 500, height = 500;
  const radius = Math.min(width, height) / 2;

  const svg = d3.select(document.body)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .append("g")
    .attr("transform", `translate(${width/2},${height/2})`);

  const color = d3.scaleOrdinal(d3.schemeCategory10);
  const pie = d3.pie().value(d => d.size);
  const arcs = pie(data.labels.map((label, i) => ({ label, size: data.sizes[i] })));

  const arc = d3.arc().innerRadius(0).outerRadius(radius);
  svg.selectAll("path")
    .data(arcs)
    .enter()
    .append("path")
    .attr("d", arc)
    .attr("fill", (d, i) => color(i));

  // Add labels
  svg.selectAll("text")
    .data(arcs)
    .enter()
    .append("text")
    .attr("transform", d => `translate(${arc.centroid(d)})`)
    .text(d => d.data.label);

  return svg.node().parentNode.outerHTML;
}

async function generateLinePlotSvg(data) {
  const { window } = new JSDOM(`<!DOCTYPE html>`);
  const document = window.document;

  const width = 800, height = 500;
  const margin = { top: 20, right: 30, bottom: 50, left: 60 };

  const svg = d3.select(document.body)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain(d3.extent(data.x)).range([0, width - margin.left - margin.right]);
  const y = d3.scaleLinear().domain(d3.extent(data.y)).range([height - margin.top - margin.bottom, 0]);

  svg.append("g").call(d3.axisBottom(x));
  svg.append("g").call(d3.axisLeft(y));

  const line = d3.line()
    .x((d, i) => x(data.x[i]))
    .y((d, i) => y(data.y[i]));

  svg.append("path")
    .datum(data.y)
    .attr("d", line)
    .attr("stroke", "steelblue")
    .attr("fill", "none");

  return svg.node().parentNode.outerHTML;
}