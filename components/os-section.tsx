'use client'

import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import Reveal from './reveal'
import { EASE_OUT } from '@/lib/scroll'

const MODULES = ['Dashboard', 'TaskFlow', 'VideoFlow', 'ArtFlow', 'ReviewFlow', 'MediaFlow']

export default function OsSection() {
  const ref = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const smooth = useSpring(scrollYProgress, { stiffness: 110, damping: 30, restDelta: 0.001 })
  const panelY = useTransform(smooth, [0, 1], ['7%', '-7%'])

  return (
    <section className="section" id="os" ref={ref}>
      <div className="wrap os">
        <Reveal>
          <span className="tag">04 / Tecnologia própria</span>
          <h2 className="h2md">O método ganha um sistema.</h2>
          <p className="lead">
            O cassiellOS organiza tarefas, produção, revisão, mídia e publicação.
          </p>
          <div className="actions">
            <a
              className="btn"
              href="https://cassiellos-web.vercel.app/"
              target="_blank"
              rel="noopener"
            >
              Acesse o cassiellOS
            </a>
          </div>
        </Reveal>

        <motion.div
          className="panel"
          style={reduced ? undefined : { y: panelY }}
          {...(reduced
            ? {}
            : {
                initial: { opacity: 0 },
                whileInView: { opacity: 1 },
                viewport: { once: true, amount: 0.25 },
                transition: { duration: 0.8, ease: EASE_OUT },
              })}
        >
          <h3>cassiellOS</h3>
          <div className="dash">
            <div className="side">
              {MODULES.map((module) => (
                <span key={module}>{module}</span>
              ))}
            </div>
            <div className="bars">
              {[0, 1, 2].map((index) => (
                <motion.div
                  key={index}
                  className="bar"
                  {...(reduced
                    ? {}
                    : {
                        initial: { scaleX: 0 },
                        whileInView: { scaleX: 1 },
                        viewport: { once: true, amount: 0.6 },
                        transition: { duration: 0.9, delay: 0.15 + index * 0.12, ease: EASE_OUT },
                      })}
                />
              ))}
              <div className="mini">
                {[0, 1, 2, 3].map((index) => (
                  <motion.i
                    key={index}
                    {...(reduced
                      ? {}
                      : {
                          initial: { opacity: 0, y: 12 },
                          whileInView: { opacity: 1, y: 0 },
                          viewport: { once: true, amount: 0.5 },
                          transition: { duration: 0.6, delay: 0.4 + index * 0.08, ease: EASE_OUT },
                        })}
                  />
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
