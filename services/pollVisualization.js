// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

let createCanvas, GlobalFonts;
try {
  ({ createCanvas, GlobalFonts } = require('@napi-rs/canvas'));
} catch (error) {
  console.warn('⚠️ Canvas not available - poll visualizations disabled:', error.message);
}
const path = require('path')
const fs = require('fs')

const fontPath = path.join(__dirname, '../assets/fonts/OpenSans/static/OpenSans-Bold.ttf')
if (fs.existsSync(fontPath)) {
  try {
    GlobalFonts.registerFromPath(fontPath, 'Open Sans')
  } catch (err) {
  }
}

function generateProgHeatmap(tallies, options) {
  if (!createCanvas) {
    console.warn('Canvas not available - cannot generate poll heatmap');
    return null;
  }
  const width = 800
  const height = 200
  const topPadding = 35
  const bottomPadding = 0
  const minHeightFromBottom = 40
  const graphHeight = height - topPadding - bottomPadding
  const maxPeakHeight = graphHeight - minHeightFromBottom
  
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  
  
  const voteCounts = options.map(opt => tallies[opt.value] || 0)
  const maxVotes = Math.max(...voteCounts, 1)
  
  const points = []
  const sectionWidth = width / options.length
  
  const dataPoints = voteCounts.map((votes, index) => {
    const x = (index + 0.5) * sectionWidth
    const normalizedHeight = (votes / maxVotes) * maxPeakHeight
    const y = height - minHeightFromBottom - normalizedHeight
    return { x, y, votes }
  })
  
  points.push(...dataPoints)
  
  const baselineY = height - minHeightFromBottom
  
  if (points.length >= 1) {
    const dx = points.length >= 2 ? points[1].x - points[0].x : sectionWidth
    points.unshift({
      x: points[0].x - dx,
      y: baselineY,
      votes: 0
    })
  }
  
  if (points.length >= 2) {
    const lastIdx = points.length - 1
    const dx = lastIdx >= 1 ? points[lastIdx].x - points[lastIdx - 1].x : sectionWidth
    points.push({
      x: points[lastIdx].x + dx,
      y: baselineY,
      votes: 0
    })
  }
  
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  
  ctx.beginPath()
  ctx.moveTo(points[0].x, baselineY)
  ctx.lineTo(points[0].x, points[0].y)
  
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    
    const clampedCp1y = Math.max(topPadding, Math.min(cp1y, baselineY))
    const clampedCp2y = Math.max(topPadding, Math.min(cp2y, baselineY))
    
    ctx.bezierCurveTo(cp1x, clampedCp1y, cp2x, clampedCp2y, p2.x, p2.y)
  }
  
  const lastPoint = points[points.length - 1]
  ctx.lineTo(lastPoint.x, baselineY)
  ctx.closePath()
  
  const gradient = ctx.createLinearGradient(0, topPadding, 0, baselineY)
  gradient.addColorStop(0, '#e74c3c')
  gradient.addColorStop(0.3, '#f39c12')
  gradient.addColorStop(0.5, '#f1c40f')
  gradient.addColorStop(0.7, '#1abc9c')
  gradient.addColorStop(1, '#3498db')
  
  ctx.fillStyle = gradient
  ctx.fill()
  
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    
    const clampedCp1y = Math.max(topPadding, Math.min(cp1y, baselineY))
    const clampedCp2y = Math.max(topPadding, Math.min(cp2y, baselineY))
    
    ctx.bezierCurveTo(cp1x, clampedCp1y, cp2x, clampedCp2y, p2.x, p2.y)
  }
  ctx.stroke()
  ctx.globalAlpha = 1.0
  
  ctx.restore()
  
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
  ctx.lineWidth = 2
  ctx.setLineDash([5, 5])
  
  for (let i = 1; i < options.length; i++) {
    const lineX = i * sectionWidth
    ctx.beginPath()
    ctx.moveTo(lineX, topPadding)
    ctx.lineTo(lineX, height)
    ctx.stroke()
  }
  
  ctx.setLineDash([])
  
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, baselineY)
  ctx.lineTo(width, baselineY)
  ctx.stroke()
  
  ctx.font = 'bold 20px "Open Sans"'
  ctx.lineWidth = 3
  ctx.strokeStyle = '#000000'
  ctx.fillStyle = '#dcddde'
  
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetX = 2
  ctx.shadowOffsetY = 2
  
  ctx.textAlign = 'center'
  
  ctx.font = 'bold 24px "Open Sans"'
  dataPoints.forEach((point) => {
    const voteText = point.votes.toString()
    const textY = point.y - 12
    ctx.strokeText(voteText, point.x, textY)
    ctx.fillText(voteText, point.x, textY)
  })
  
  ctx.font = 'bold 20px "Open Sans"'
  dataPoints.forEach((point, index) => {
    const label = options[index].label
    ctx.strokeText(label, point.x, height - 8)
    ctx.fillText(label, point.x, height - 8)
  })
  
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  
  return canvas.toBuffer('image/png')
}

function generatePollImage(input) {
  if (!createCanvas) {
    const detail = canvasLoadError?.message ? `: ` : '';
    throw new Error(`@napi-rs/canvas is required to render poll result images`);
  }

  const buffer = generateProgHeatmap(input.tallies, input.options);
  const isPng = buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (!isPng) {
    throw new Error('Poll renderer did not produce a valid PNG buffer');
  }

  return {
    buffer,
    extension: 'png',
    contentType: 'image/png'
  };
}

module.exports = {
  generateProgHeatmap,
  generatePollImage
}
