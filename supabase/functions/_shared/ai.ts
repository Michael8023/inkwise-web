import { env } from "./core.ts";
export async function complete(model:string,messages:Array<{role:string;content:string}>,max_tokens=1200){ const response=await fetch(`${(Deno.env.get("APILIO_BASE_URL")||"https://api.apilio.ai/v1").replace(/\/$/,"")}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${env("APILIO_API_KEY")}`,"Content-Type":"application/json"},body:JSON.stringify({model,messages,temperature:.2,max_tokens,stream:false})}); const payload=await response.json(); if(!response.ok||!payload.choices?.[0]?.message?.content) throw new Error(payload.error?.message||`AI_UPSTREAM_${response.status}`); return payload.choices[0].message.content as string; }
export async function completeVision(model:string,prompt:string,imageDataUrl:string,max_tokens=1600){const response=await fetch(`${(Deno.env.get("APILIO_BASE_URL")||"https://api.apilio.ai/v1").replace(/\/$/,"")}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${env("APILIO_API_KEY")}`,"Content-Type":"application/json"},body:JSON.stringify({model,messages:[{role:"user",content:[{type:"text",text:prompt},{type:"image_url",image_url:{url:imageDataUrl,detail:"high"}}]}],temperature:.2,max_tokens,stream:false})});const payload=await response.json();if(!response.ok||!payload.choices?.[0]?.message?.content){const upstream=String(payload.error?.message||"");if(/image|vision|multimodal|content type/i.test(upstream))throw new Error("MODEL_VISION_UNSUPPORTED");throw new Error(upstream||`AI_UPSTREAM_${response.status}`);}return payload.choices[0].message.content as string;}
export function modelOrDefault(model:string){
  // Availability and permissions are enforced by model_catalog in reserve().
  // APILIO_MODELS is retained only for backwards-compatible deployments.
  const configured=(Deno.env.get("APILIO_MODELS")||"").split(",").map(x=>x.trim()).filter(Boolean);
  const selected=model||Deno.env.get("APILIO_DEFAULT_MODEL")||configured[0];
  if(!selected) throw new Error("MODEL_DISABLED");
  return selected;
}
