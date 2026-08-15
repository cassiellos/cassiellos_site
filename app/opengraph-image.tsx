import { ImageResponse } from 'next/og'
import { INFINITY_PATH } from '@/components/infinity-mark'
import { SITE_DESCRIPTION } from '@/lib/site'

export const alt = SITE_DESCRIPTION
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Satori não lê woff2, que é o formato entregue pelo next/font. Buscamos o TTF
 * do Inter no momento do build — com User-Agent antigo o Google devolve
 * truetype. Se a rede falhar, o card cai na fonte padrão em vez de quebrar.
 */
async function loadInter(weight: 400 | 700) {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${weight}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko',
      },
    }).then((response) => response.text())

    const url = css.match(/src:\s*url\((https:[^)]+)\)/)?.[1]
    if (!url) return null

    const data = await fetch(url).then((response) => response.arrayBuffer())
    return { name: 'Inter', data, weight, style: 'normal' as const }
  } catch {
    return null
  }
}

export default async function OpengraphImage() {
  const fonts = (await Promise.all([loadInter(400), loadInter(700)])).filter(
    (font): font is NonNullable<typeof font> => font !== null,
  )

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#07101f',
          backgroundImage:
            'radial-gradient(circle at 82% 22%, #246bff33, transparent 42%), radial-gradient(circle at 8% 92%, #7b35f524, transparent 44%)',
          fontFamily: fonts.length ? 'Inter' : 'sans-serif',
          color: '#ffffff',
        }}
      >
        {/* marca */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg width="92" height="46" viewBox="0 0 64 32">
            <path
              d={INFINITY_PATH}
              fill="none"
              stroke="#f13c4b"
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1.6 }}>Cassiellos</div>
        </div>

        {/* mensagem */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 3.6,
              color: '#f13c4b',
            }}
          >
            EMPRESA DE OPERAÇÕES CRIATIVAS
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: 24,
              fontSize: 60,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: -2.4,
            }}
          >
            <div style={{ display: 'flex' }}>Marketing organizado,</div>
            <div style={{ display: 'flex', color: '#9cd8f5' }}>
              do planejamento à publicação.
            </div>
          </div>
        </div>

        {/* rodapé */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 24,
            color: '#a8b4c9',
          }}
        >
          <div style={{ display: 'flex' }}>Estratégia · Conteúdo · Operações</div>
          <div style={{ display: 'flex' }}>agenciacassiellos.com.br</div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  )
}
