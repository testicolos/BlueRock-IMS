import { createElement } from 'react';
import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';

export async function generateStaticParams() {
  return [{ size: '192' }, { size: '512' }];
}

export async function GET(_request: Request, context: { params: Promise<{ size: string }> }) {
  const { size: rawSize } = await context.params;
  const size = rawSize === '192' ? 192 : 512;
  const mark = createElement('div', {
    style: {
      width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', background: 'linear-gradient(145deg,#242625,#111312)', fontFamily: 'Arial, sans-serif',
      position: 'relative', borderRadius: size * .18,
    },
  },
  createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
    createElement('div', { style: { color: '#f36b21', fontSize: size * .27, fontWeight: 900, letterSpacing: -size * .02 } }, 'BR'),
    createElement('div', { style: { color: '#fff', fontSize: size * .105, fontWeight: 800, letterSpacing: size * .012 } }, 'IMS'),
  ),
  createElement('div', { style: { position: 'absolute', left: size * .14, right: size * .14, bottom: size * .105, height: size * .022, background: '#f36b21', borderRadius: 99 } }));
  return new ImageResponse(mark, { width: size, height: size });
}
