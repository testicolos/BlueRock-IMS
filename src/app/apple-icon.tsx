import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'linear-gradient(145deg,#242625,#111312)',color:'#fff',fontFamily:'Arial, sans-serif',borderRadius:32}}>
      <div style={{display:'flex',color:'#f36b21',fontSize:52,fontWeight:900,letterSpacing:-4}}>BR</div>
      <div style={{display:'flex',fontSize:21,fontWeight:800,letterSpacing:3}}>IMS</div>
    </div>,
    size,
  );
}
