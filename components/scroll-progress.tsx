'use client'

import { motion, useScroll, useSpring } from 'motion/react'

/** Fio de progresso de leitura no topo da página. */
export default function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 28,
    restDelta: 0.001,
  })

  return <motion.div className="progress" style={{ scaleX }} aria-hidden />
}
