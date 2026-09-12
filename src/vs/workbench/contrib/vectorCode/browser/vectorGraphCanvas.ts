/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IVectorGraphCanvas } from '../../../../platform/vectorGraph/common/vectorGraphDocuments.js';

/** Render the API scene as native SVG without interpreting remote markup or scripts. */
export function renderVectorGraphCanvas(parent: HTMLElement, canvas: IVectorGraphCanvas): SVGSVGElement {
	const ns = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', canvas.title); svg.style.width = '100%'; svg.style.height = '100%'; svg.style.minHeight = '400px';
	const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(-1000000, Math.min(1000000, value)) : fallback;
	const color = (value: unknown, fallback: string) => typeof value === 'string' && /^(#[0-9a-f]{6}|transparent)$/i.test(value) ? value : fallback;
	let left = 0, top = 0, right = 600, bottom = 400;
	for (const element of canvas.scene.elements) {
		const x = number(element.x, 0), y = number(element.y, 0), width = Math.max(1, number(element.width, 200)), height = Math.max(1, number(element.height, 100));
		const toX = number(element.toX, x + width), toY = number(element.toY, y + height);
		left = Math.min(left, x, toX); top = Math.min(top, y, toY); right = Math.max(right, x + width, toX); bottom = Math.max(bottom, y + height, toY);
		const group = document.createElementNS(ns, 'g'); svg.appendChild(group);
		group.setAttribute('transform', `rotate(${number(element.rotation, 0)} ${x + width / 2} ${y + height / 2})`);
		group.setAttribute('opacity', String(Math.max(0.05, Math.min(1, number(element.opacity, 1)))));
		const shape = (tag: string, attrs: Record<string, string | number>) => { const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) { node.setAttribute(key, String(value)); } group.appendChild(node); return node; };
		const style = { stroke: color(element.color, '#17252E'), fill: color(element.fill, element.type === 'sticky' ? '#FFF2B3' : 'transparent'), 'stroke-width': Math.max(1, number(element.strokeWidth, 2)) };
		switch (element.type) {
			case 'line': case 'arrow':
				shape('line', { x1: x, y1: y, x2: toX, y2: toY, ...style });
				if (element.type === 'arrow') { const angle = Math.atan2(toY - y, toX - x); shape('polyline', { points: `${toX - 12 * Math.cos(angle - 0.5)},${toY - 12 * Math.sin(angle - 0.5)} ${toX},${toY} ${toX - 12 * Math.cos(angle + 0.5)},${toY - 12 * Math.sin(angle + 0.5)}`, ...style, fill: 'none' }); } break;
			case 'freehand': {
				const points = Array.isArray(element.points) ? element.points.slice(0, 10000).filter((point): point is Record<string, unknown> => !!point && typeof point === 'object') : [];
				shape('polyline', { points: points.map(point => `${number(point.x, x)},${number(point.y, y)}`).join(' '), ...style, fill: 'none' }); break;
			}
			case 'circle': shape('ellipse', { cx: x + width / 2, cy: y + height / 2, rx: width / 2, ry: height / 2, ...style }); break;
			case 'diamond': shape('polygon', { points: `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`, ...style }); break;
			case 'triangle': shape('polygon', { points: `${x + width / 2},${y} ${x + width},${y + height} ${x},${y + height}`, ...style }); break;
			case 'hexagon': shape('polygon', { points: `${x + width / 4},${y} ${x + width * 0.75},${y} ${x + width},${y + height / 2} ${x + width * 0.75},${y + height} ${x + width / 4},${y + height} ${x},${y + height / 2}`, ...style }); break;
			case 'text': break;
			default: shape('rect', { x, y, width, height, rx: element.type === 'mindmap' ? height / 2 : 4, ...style });
		}
		const text = typeof element.text === 'string' ? element.text : typeof element.name === 'string' ? element.name : '';
		const fontSize = Math.max(8, Math.min(160, number(element.fontSize, 16)));
		for (const [index, line] of text.split('\n').entries()) { const node = shape('text', { x: x + 12, y: y + fontSize + 10 + index * fontSize * 1.3, fill: color(element.color, '#17252E'), 'font-size': fontSize, 'font-family': 'sans-serif', 'font-weight': number(element.fontWeight, 400) }); node.textContent = line; }
		if (element.type === 'table' && Array.isArray(element.tableCells)) {
			const columns = Math.max(1, Math.min(20, number(element.columns, 2))), rows = Math.max(1, Math.min(50, number(element.rows, 2)));
			for (let i = 1; i < columns; i++) { shape('line', { x1: x + i * width / columns, y1: y, x2: x + i * width / columns, y2: y + height, ...style }); }
			for (let i = 1; i < rows; i++) { shape('line', { x1: x, y1: y + i * height / rows, x2: x + width, y2: y + i * height / rows, ...style }); }
			element.tableCells.slice(0, rows * columns).forEach((cell, i) => { if (typeof cell === 'string') { shape('text', { x: x + (i % columns) * width / columns + 6, y: y + Math.floor(i / columns) * height / rows + 20, fill: style.stroke, 'font-size': 14 }).textContent = cell; } });
		}
	}
	svg.setAttribute('viewBox', `${left - 30} ${top - 30} ${right - left + 60} ${bottom - top + 60}`); parent.appendChild(svg); return svg;
}
