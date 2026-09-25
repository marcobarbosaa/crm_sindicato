import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root=resolve("outputs/attachments-harness");mkdirSync(root,{recursive:true});
writeFileSync(resolve(root,"index.html"),'<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>');
writeFileSync(resolve(root,"main.jsx"),'import React from "react";import {createRoot} from "react-dom/client";import {CrmApp} from "@/app/crm-app";import {Toaster} from "@/components/ui/sonner";import "@/app/globals.css";createRoot(document.getElementById("root")).render(<><CrmApp/><Toaster/></>);');
const server=await createServer({configFile:false,root,plugins:[react()],resolve:{alias:{"@":process.cwd()}},server:{host:"localhost",port:5174,strictPort:true,fs:{allow:[process.cwd()]}},css:{postcss:process.cwd()}});
await server.listen();console.log("UI harness ready at http://localhost:5174 (APIs must be intercepted by test-email-ui.mjs)");
