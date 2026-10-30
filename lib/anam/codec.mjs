// Independent reuse of the existing AES-GCM envelope pattern; no James imports,
// key discovery, environment reads or plaintext storage fallback.
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {CaptureApplicationError as Fault} from './errors.mjs';
export function createCaptureCodec(key){
 if(!Buffer.isBuffer(key)||key.length!==32)throw new Fault('CAPTURE_ENCRYPTION_KEY_REQUIRED',503);
 const privateKey=Buffer.from(key),aad=(id,revision)=>Buffer.from('xagent:capture:history:v1\0'+id+'\0'+revision);
 return {
  seal(entry,id,revision){
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',privateKey,iv);cipher.setAAD(aad(id,revision));
   const data=Buffer.concat([cipher.update(JSON.stringify(entry),'utf8'),cipher.final()]);
   return JSON.stringify({v:1,revision,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});
  },
  open(raw,id,revision){try{
   const box=JSON.parse(raw);
   if(Object.keys(box).sort().join(',')!=='data,iv,revision,tag,v'||box.v!==1||box.revision!==revision)throw new Error();
   const iv=Buffer.from(box.iv,'base64'),tag=Buffer.from(box.tag,'base64');if(iv.length!==12||tag.length!==16)throw new Error();
   const decipher=createDecipheriv('aes-256-gcm',privateKey,iv);decipher.setAAD(aad(id,revision));decipher.setAuthTag(tag);
   return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data,'base64')),decipher.final()]).toString('utf8'));
  }catch{throw new Fault('CAPTURE_ENVELOPE_INTEGRITY_REQUIRES_REVIEW',503);}},
 };
}
