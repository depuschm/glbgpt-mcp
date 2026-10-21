# Models

Snapshot of what this connector can use, checked on **21 October 2026**. GlobalGPT adds and retires models, so `glbgpt_list_models` always has the live list; this page shows the state and test results at the date above.

- **API**: GlobalGPT's official API, with `GLBGPT_API_KEY`. Prices are GlobalGPT's API prices in credits (media: the price at the model's default settings; resolution, duration and audio change it).
- **Website**: chat models only on glbgpt.com, reached through the website's chat with `GLBGPT_TOKEN` (text only, no images; each message lands in your glbgpt.com history).
- **Website media**: images, videos, tools, 3D and speech to text only on glbgpt.com, also through `GLBGPT_TOKEN`.
- **Not supported**: on glbgpt.com, but not reachable through this connector (yet).

Totals: **103 through the API** (42 chat, 29 image, 21 video, 11 audio), **18 more chat models through the website**, and **37 website-only media models and tools** (tested live on 21 October 2026, see below).

## Chat

### API (42)

Price in credits per 1K tokens, input / output.

| Model | ID | Price |
|---|---|---|
| Claude Fable 5.1 | `claude-fable-5.1` | 33 / 167 |
| Claude Fable 5 | `claude-fable-5` | 33 / 167 |
| Claude Opus 5 | `claude-opus-5` | 17 / 83 |
| Claude Sonnet 5 | `claude-sonnet-5` | 7 / 33 |
| Claude Opus 4.8 | `claude-opus-4.8` | 17 / 83 |
| Claude Opus 4.7 | `claude-opus-4.7` | 17 / 83 |
| Claude Opus 4.6 | `claude-opus-4.6` | 17 / 83 |
| Claude Opus 4.5 | `claude-opus-4.5` | 17 / 83 |
| Claude Haiku 4.5 | `claude-haiku-4.5` | 3 / 17 |
| GPT-6 Astra | `gpt-6-astra` | 23 / 117 |
| GPT-5.6 Sol | `gpt-5.6-sol` | 17 / 100 |
| GPT-5.6 Terra | `gpt-5.6-terra` | 7 / 40 |
| GPT-5.6 Luna | `gpt-5.6-luna` | 1 / 4 |
| GPT-5.5 | `gpt-5.5` | 9 / 78 |
| GPT-5.4 mini | `gpt-5.4-mini` | 3 / 15 |
| GPT-5.4 nano | `gpt-5.4-nano` | 1 / 4 |
| GPT-4o | `gpt-4o` | 10 / 30 |
| Gemini 3.8 Flash | `gemini-3.8-flash` | 5 / 25 |
| Gemini 3.6 Flash | `gemini-3.6-flash` | 5 / 25 |
| Gemini 3.5 Flash Lite | `gemini-3.5-flash-lite` | 1 / 8 |
| Gemini 3.1 Pro | `gemini-3.1-pro` | 10 / 50 |
| Gemini 3.1 Flash Lite | `gemini-3.1-flash-lite` | 1 / 5 |
| Gemini 3 Pro | `gemini-3-pro` | 13 / 60 |
| Gemini 3 Flash | `gemini-3-flash` | 2 / 10 |
| Gemini 2.5 Pro | `gemini-2.5-pro` | 8 / 50 |
| Gemini 2.5 Flash | `gemini-2.5-flash` | 1 / 8 |
| Gemini Omni Flash (preview) | `gemini-omni-flash-preview` | 5 / 30 |
| Grok 4.6 | `grok-4.6` | not listed |
| Grok 4.3 | `grok-4.3` | 4 / 8 |
| GLM-5.3 | `glm-5.3` | 5 / 15 |
| GLM-5.3 Flash | `glm-5.3-flash` | 1 / 1 |
| GLM-5.2 | `glm-5.2` | 5 / 15 |
| Kimi K3 | `kimi-k3` | 10 / 50 |
| Kimi K2.6 | `kimi-k2.6` | 3 / 13 |
| DeepSeek V4.1 Flash | `deepseek-v4.1-flash` | 1 / 4 |
| DeepSeek V4 Pro | `deepseek-v4-pro` | 4 / 13 |
| Qwen3.8 Max | `qwen3.8-max` | 7 / 20 |
| Qwen3.8 Flash | `qwen3.8-flash` | 1 / 2 |
| Muse Spark 1.3 | `muse-spark-1.3` | 4 / 14 |
| Muse Spark 1.2 | `muse-spark-1.2` | 4 / 14 |
| Agnes 3.0 Flash | `agnes-3.0-flash` | 1 / 1 |
| Agnes 2.5 Flash | `agnes-2.5-flash` | 1 / 1 |

### Website (29, needs `GLBGPT_TOKEN`)

Each was tested with one short message on 21 October 2026.

| Model | ID | Status |
|---|---|---|
| Claude Opus 5.5 | `claude-opus-5.5` | ✅ works |
| Claude Sonnet 5.5 | `claude-sonnet-5.5` | ✅ works |
| Claude Haiku 5.5 | `claude-haiku-5.5` | ✅ works |
| Claude Sonnet 4.6 | `claude-sonnet-4.6` | ✅ works |
| Claude Sonnet 4.5 | `claude-sonnet-4.5` | ✅ works |
| GPT-6.1 Sol | `gpt-6.1-sol` | ✅ works |
| GPT-6 Sol | `gpt-6-sol` | ✅ works |
| GPT-6 Luna | `gpt-6-luna` | ✅ works |
| GPT-5.4 | `gpt-5.4` | ✅ works |
| GPT-5.2 | `gpt-5.2` | ✅ works |
| GPT-5.1 | `gpt-5.1` | ✅ works |
| GPT-5 | `gpt-5` | ✅ works |
| GPT-5 mini | `gpt-5-mini` | ✅ works |
| GPT-5 nano | `gpt-5-nano` | ✅ works |
| Gemini 4 Argon | `gemini-4-argon` | ✅ works |
| Gemini 3.7 Flash | `gemini-3.7-flash` | ✅ works |
| Grok 4.7 | `grok-4.7` | ✅ works |
| Muse Wonder | `muse-wonder` | ✅ works |
| o1 | `o1` | ❌ GlobalGPT's backend can't reach the provider |
| o3 | `o3` | ❌ GlobalGPT's backend can't reach the provider |
| o3-mini | `o3-mini` | ❌ GlobalGPT's backend can't reach the provider |
| o3 Mini High | `o3-mini-high` | ❌ GlobalGPT's backend can't reach the provider |
| o4 Mini | `o4-mini` | ❌ GlobalGPT's backend can't reach the provider |
| GPT-5.3 | `gpt-5.3` | ❌ empty answer (retired in the API) |
| DeepSeek V4 Flash | `deepseek-v4-flash` | ❌ GlobalGPT's backend can't reach the provider |
| Kimi K2.5 | `kimi-k2.5` | ❌ GlobalGPT's backend can't reach the provider |
| Perplexity | `perplexity` (or `sonar`) | ❌ GlobalGPT's backend can't reach the provider |
| Gemini 3.5 Flash | `gemini-3.5-flash` | ❌ refused: "invalid product no" |
| GLM-5.1 | `glm-5.1` | ❌ refused: "invalid product no" |

The ❌ ones are wired up and start working by themselves once GlobalGPT fixes them on their side.

## Image (API, 29)

Price in credits per image, at the default resolution.

| Model | ID | Price |
|---|---|---|
| GPT Image 2.5 | `gpt-image-2.5` | 320 |
| GPT Image 2 | `gpt-image-2` | 320 |
| Nano Banana 2.1 | `nano-banana-2.1` | 200 |
| Nano Banana 2 | `nano-banana-2` | 300 |
| Nano Banana Pro | `nano-banana-pro` | 500 |
| Nano Banana | `nano-banana` | 100 |
| Seedream 5.0 Pro | `seedream-5.0-pro` | 200 |
| Seedream 5.0 Lite | `seedream-5.0-lite` | 200 |
| Seedream 5.0 Flash | `seedream-5-0-flash` | 100 |
| Seedream 4.5 | `seedream-4.5` | 200 |
| FLUX 3 Image | `flux-3-image` | 130 |
| FLUX.2 Pro | `flux-2-pro` | 100 |
| FLUX 1.1 Pro Ultra | `flux-pro-1.1-ultra` | 200 |
| FLUX 1.1 Pro | `flux-pro-1.1` | 140 |
| FLUX.1 Dev | `flux-dev` | 85 |
| FLUX.1 Kontext Pro (editing, needs an image) | `flux-kontext-pro` | 500 |
| Ideogram 4.0 Quality | `ideogram-v4-quality` | 330 |
| Ideogram 4.0 | `ideogram-v4` | 200 |
| Ideogram 4.0 Turbo | `ideogram-v4-turbo` | 100 |
| Agnes Image 2.1 Flash | `agnes-image-2.1-flash` | 10 |

**Image tools** (need an input image):

| Tool | ID | Price |
|---|---|---|
| Remove background | `remove-bg` | 40 |
| Remove text / watermark | `remove-watermark` | 140 |
| HD upscale | `hd-upscale` | 170 |
| Expand / outpaint | `ai-expand` | 40 |
| ID photo / headshot | `id-photo` | 140 |
| Face swap (2 images) | `face-swap` | 50 |
| Change haircut | `change-haircut` | 140 |
| Virtual try-on (2 images) | `virtual-tryon` | 100 |
| Change background | `change-background` | 140 |

## Video (API, 21)

Price in credits per video, at the default resolution and length.

| Model | ID | Price |
|---|---|---|
| Kling 3.0 | `kling-v3` | 700 |
| Kling 2.6 | `kling-v2-6` | 600 |
| Seedance 2.5 | `seedance-2.5` | 1,600 |
| Seedance 2.0 | `seedance-2.0` | 1,200 |
| Seedance 2.0 Fast | `seedance-2.0-fast` | 1,000 |
| Wan 3.0 | `wan3.0-video` | 1,000 |
| MiniMax-H3 | `minimax-h3` | 1,300 |
| FLUX 3 Video | `flux-3-video` | 2,300 |
| Sora 2 | `sora-2` | 600 |
| Veo 3.1 | `veo3.1` | 1,500 |
| Grok Imagine 1.5 | `grok-imagine-video-1.5` | 750 |
| Grok Imagine | `grok-imagine-video` | 500 |
| Agnes Video 2.5 | `agnes-video-2.5` | 420 |
| Agnes Video 2.5 Flash | `agnes-video-2.5-flash` | 420 |
| Agnes Video 2.0 | `agnes-video-v2.0` | 75 |
| Happy Horse 1.0 (text to video) | `happyhorse-1.0-t2v` | 2,100 |
| Happy Horse 1.0 (image to video) | `happyhorse-1.0-i2v` | 2,100 |
| Happy Horse 1.0 (reference to video) | `happyhorse-1.0-r2v` | 2,100 |
| Happy Horse 1.0 (video edit) | `happyhorse-1.0-video-edit` | 2,100 |
| Runway Gen-4 Turbo (needs an image) | `runway-gen4-turbo` | 200 |
| Luma Ray 2 Flash | `luma-ray-2-flash` | 875 |

## Audio (API, 11)

| Model | ID | Price |
|---|---|---|
| ElevenLabs v4 (speech) | `eleven_v4` | 330 per 1K characters |
| ElevenLabs v4 Turbo (speech) | `eleven_v4_turbo` | 165 per 1K characters |
| ElevenLabs v3 (speech) | `eleven-v3` | 330 per 1K characters |
| ElevenLabs Multilingual v2 (speech) | `eleven-multilingual-v2` | 330 per 1K characters |
| Qwen Audio 3.0 TTS Flash (speech) | `qwen-audio-3.0-tts-flash` | 330 per 1K characters |
| Seed Audio 1.0 (speech, sound) | `seed-audio-1.0` | 8 per second |
| ElevenLabs Music | `eleven-music-v2` | 8 per second |
| Mureka v9 Song (lyrics to song) | `mureka-v9-song` | 150 |
| Mureka v9 BGM (background music) | `mureka-v9-bgm` | 150 |
| Google Lyria 3 Clip | `lyria-3-clip` | 133 |
| Google Lyria 3 Pro | `lyria-3-pro` | 267 |

## Website-only media (needs `GLBGPT_TOKEN`)

Images, videos, tools, 3D and speech to text that only glbgpt.com has. `glbgpt_generate` sends them through the website's own endpoints with your login token, using the request formats read from the website's code on 21 October 2026. `glbgpt_list_models` shows each one's inputs (`usage`).

**Status: tested live on 21 October 2026** with one generation each at the cheapest settings. Prices are the website's list prices; for videos they're estimates (GlobalGPT bills the exact amount).

| Kind | Model | ID | From (credits) | Live test |
|---|---|---|---|---|
| Image | Ideogram 4.5 | `ideogram-4.5` | 27 (very low) to 730 | ✅ works (`metadata.quality` low, 100) |
| Image | Ideogram 3.0 / Turbo / Quality | `ideogram-3.0` / `ideogram-3.0-turbo` / `ideogram-3.0-quality` | 200 / 100 / 300 | ✅ all three work |
| Image | Midjourney | `midjourney` | 100 | ✅ works (returns the 2x2 grid) |
| Image | MAI Image 2.6 / 2.6 Flash | `mai-image-2.6` / `mai-image-2.6-flash` | 104 / 52 | ✅ both work |
| Image | Krea 3 | `krea-3` | 25 (0.5K) | ✅ works (0.5K) |
| Image | Qwen Image 3.0 / 3.0 Pro | `qwen-image-3.0` / `qwen-image-3.0-pro` | 100 / 133 | ✅ both work |
| Image | FLUX.3 Klein | `flux-3-klein` | 21 (768sq) | ✅ works (768sq) |
| Image | HiDream O1 / O1 Dev / E1 Full / I1 Full / I1 Dev | `hidream-o1` / `hidream-o1-dev` / `hidream-e1-full` / `hidream-i1-full` / `hidream-i1-dev` | 133 / 67 / 80 / 80 / 40 | ✅ all five work (E1 Full edits one image) |
| Image tool | AI Poster | `ai-poster` | 400 | ⚠️ works with a prompt only; `metadata.textBlocks` as plain strings is refused (code 0, "Sorry, something went wrong") |
| Image tool | AI Product Images | `ai-product-images` | 400 | ✅ works |
| Video | Veo 3 | `veo3` | 1,500 | ✅ works (fixed 5 s) |
| Video | Kling O1 | `kling-o1` | about 200 per second | ⚠️ works at 5 s; the website only takes 5 or 10 s (3 s is refused) |
| Video | Wan 3.0 Prime | `wan3.0-video-prime` | about 160 per second | ✅ works (2 s, 480P) |
| Video | Wan 2.7 | `wan-2.7` | about 200 per second | ✅ works (2 s) |
| Video | Wan 2.6 | `wan-2.6` | about 200 per second | ⚠️ works only with `aspect_ratio` as a size (`1280*720`, `720*1280`, `1920*1080`, `1080*1920`); the default `16:9` is refused ("Invalid size value") |
| Video | Seedance 1.0 Pro | `seedance-1.0-pro` | 2,000 (5 s) | ⏳ submitted fine (5 s), but stuck in GlobalGPT's own queue ("High demand right now") for 8+ hours; the website shows it as "In queue" too, so the connector reports it correctly |
| Video | HeyGen avatar video | `heygen-video` | quoted per video (about 1,000 per minute) | ❌ "Insufficient credit. This operation requires 'api' credits." (voices list works) |
| Video tool | Video Upscale | `video-upscale` | 35 / 125 / 498 per second (720p / 1080p / 4K) | ✅ works (720p) |
| Video tool | Video Sound | `video-sound` | 1.5 per second | ✅ works |
| Video tool | Video Reframe | `video-reframe` | 200 per second | ✅ works (9:16) |
| Video tool | Talking Photo | `talking-photo` | 83 / 150 per second of speech | ✅ works (720p) |
| Video tool | Video Translator | `video-translate` | 222 per second | ❌ failed with GlobalGPT's "generation service temporarily unavailable" (tested on a 2 s clip with no speech) |
| 3D | Hunyuan 3D 3.1 / Tripo h3.1 / Meshy 7 / TRELLIS 3D / Rodin Gen-2 | `hunyuan-3d-3.1` / `tripo-h3.1` / `meshy-7` / `trellis-3d` / `rodin-gen-2` | 100 / 330 / 1,760 / 500 / 1,400 | ✅ all five work (GLB) |
| Speech to text | Scribe v2 | `scribe-v2` | 12 per minute | ✅ works (returns a .txt transcript) |
| Speech to text | Scribe v1 | `scribe-v1` | 12 per minute | not tested |

Known connector issues found in the live test: website media errors say "refused the chat" (the chat error wording), `glbgpt_check_task` reports 3D results as `type: "image"`, and `glbgpt_usage` lists only API generations, not website ones.

## Not supported

- **AI Detector, AI Image Detector, AI Video Detector**: they need files uploaded into GlobalGPT's media library first (and a frame upload for videos); could be added later.
- **Logo Maker**: not looked at yet.
- **Whole apps, not suitable as connector tools**: Yukie, Agentic Canvas, GlobalClaw, Deep Research, ChatPDF, AI Translate, AI Note Taker.
