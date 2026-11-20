'use client'

import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'motion/react'
import styles from './home-v3.module.css'

const STEP = Math.PI / 9 // linhas a cada 20°

/** Globo em malha (canvas 2D) girando, com brilho da marca e as frentes de trabalho em volta. */
export default function GlobeSquad({ labels }: { labels: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let width = 0
    let height = 0
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()

    const tilt = 0.32
    const project = (lat: number, lon: number, spin: number) => {
      const x = Math.cos(lat) * Math.sin(lon + spin)
      const y = Math.sin(lat)
      const z = Math.cos(lat) * Math.cos(lon + spin)
      // inclina o eixo para a frente
      const y2 = y * Math.cos(tilt) - z * Math.sin(tilt)
      const z2 = y * Math.sin(tilt) + z * Math.cos(tilt)
      const r = Math.min(width, height) * 0.44
      return { x: width / 2 + x * r, y: height / 2 - y2 * r, z: z2 }
    }

    const stroke = (points: { x: number; y: number; z: number }[]) => {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]
        const b = points[i]
        const depth = (a.z + b.z) / 2 // -1 (fundo) a 1 (frente)
        ctx.strokeStyle = `rgba(246, 248, 255, ${0.08 + Math.max(depth, -0.6) * 0.32 + 0.22})`
        ctx.lineWidth = depth > 0 ? 1.2 : 0.7
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }

    const draw = (spin: number) => {
      ctx.clearRect(0, 0, width, height)
      for (let lat = -Math.PI / 2 + STEP; lat < Math.PI / 2 - 0.01; lat += STEP) {
        const ring = []
        for (let lon = 0; lon <= Math.PI * 2 + 0.01; lon += Math.PI / 48) ring.push(project(lat, lon, spin))
        stroke(ring)
      }
      for (let lon = 0; lon < Math.PI * 2 - 0.01; lon += STEP) {
        const meridian = []
        for (let lat = -Math.PI / 2; lat <= Math.PI / 2 + 0.01; lat += Math.PI / 48) meridian.push(project(lat, lon, spin))
        stroke(meridian)
      }
    }

    let frame = 0
    let running = false
    let spin = 0
    let last = performance.now()
    const loop = (now: number) => {
      spin += ((now - last) / 1000) * 0.18
      last = now
      draw(spin)
      frame = requestAnimationFrame(loop)
    }

    draw(0.4)
    const visibility = new IntersectionObserver(([entry]) => {
      if (reduced) return
      if (entry.isIntersecting && !running) {
        running = true
        last = performance.now()
        frame = requestAnimationFrame(loop)
      } else if (!entry.isIntersecting && running) {
        running = false
        cancelAnimationFrame(frame)
      }
    })
    visibility.observe(canvas)
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(frame)
      visibility.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [reduced])

  return (
    <div className={styles.globeStage}>
      <i className={styles.globeGlow} aria-hidden="true" />
      <canvas ref={canvasRef} className={styles.globeCanvas} aria-hidden="true" />
      <ul className={styles.globeLabels}>
        {labels.map((label, index) => (
          <li key={label} style={{ ['--i' as string]: index, ['--n' as string]: labels.length }}>{label}</li>
        ))}
      </ul>
    </div>
  )
}
