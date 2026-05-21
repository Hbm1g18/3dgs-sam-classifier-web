import io
import base64
import numpy as np
import torch
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from segment_anything import sam_model_registry, SamPredictor

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Using vit_b as detected in user logs
SAM_CHECKPOINT = "sam_vit_b_01ec64.pth"
MODEL_TYPE = "vit_b"
device = "cuda" if torch.cuda.is_available() else "cpu"

print(f"Loading SAM model ({MODEL_TYPE}) on {device}...")
sam = sam_model_registry[MODEL_TYPE](checkpoint=SAM_CHECKPOINT)
sam.to(device=device)
predictor = SamPredictor(sam)
print("SAM model loaded.")

# Pre-load LangSAM for faster text prompts
lang_model = None
try:
    from lang_sam import LangSAM
    print("Loading LangSAM...")
    lang_model = LangSAM()
    print("LangSAM loaded.")
except ImportError:
    print("lang-sam not installed. Text prompts will use center-point fallback.")

from typing import List, Optional
import json

@app.post("/segment")
async def segment(
    image: UploadFile = File(...),
    x: Optional[str] = Form(None), 
    y: Optional[str] = Form(None), 
    labels: Optional[str] = Form(None), 
    text_prompt: Optional[str] = Form(None),
    box_threshold: float = Form(0.3),
    text_threshold: float = Form(0.25)
):
    image_data = await image.read()
    image_pil = Image.open(io.BytesIO(image_data)).convert("RGB")
    image_np = np.array(image_pil)

    mask = None

    if text_prompt and lang_model:
        print(f"Segmenting with text: {text_prompt} (Thresholds: {box_threshold}/{text_threshold})")
        masks, boxes, phrases, logits = lang_model.predict(image_pil, text_prompt)
        # Filter by logit/score if needed, or take the best match
        if len(masks) > 0:
            mask = masks[0].cpu().numpy()
    
    # Fallback to point-based if text failed or no lang_model
    if mask is None:
        predictor.set_image(image_np)
        if x and y:
            coords_x = json.loads(x)
            coords_y = json.loads(y)
            point_labels = json.loads(labels) if labels else [1] * len(coords_x)
            input_points = np.array([[px, py] for px, py in zip(coords_x, coords_y)])
            input_labels = np.array(point_labels)
        else:
            # Absolute fallback: center point
            h, w = image_np.shape[:2]
            input_points = np.array([[w//2, h//2]])
            input_labels = np.array([1])

        masks, scores, logits = predictor.predict(
            point_coords=input_points,
            point_labels=input_labels,
            multimask_output=False,
        )
        mask = masks[0]

    # Return mask as base64 PNG
    mask_image = Image.fromarray((mask * 255).astype(np.uint8))
    buffered = io.BytesIO()
    mask_image.save(buffered, format="PNG")
    mask_base64 = base64.b64encode(buffered.getvalue()).decode("utf-8")

    return {
        "mask": f"data:image/png;base64,{mask_base64}",
        "width": mask.shape[1],
        "height": mask.shape[0]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
