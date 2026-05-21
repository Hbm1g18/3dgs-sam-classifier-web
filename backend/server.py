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

@app.post("/segment")
async def segment(
    image: UploadFile = File(...),
    x: int = Form(...),
    y: int = Form(...)
):
    # Read uploaded file
    image_data = await image.read()
    image_pil = Image.open(io.BytesIO(image_data)).convert("RGB")
    image_np = np.array(image_pil)

    # Set image in predictor
    predictor.set_image(image_np)

    # Predict mask based on click
    input_point = np.array([[x, y]])
    input_label = np.array([1]) 

    masks, scores, logits = predictor.predict(
        point_coords=input_point,
        point_labels=input_label,
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
