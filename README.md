# ArtisanGS Pro Classifier

A high-performance C++ tool for classifying and cleaning 3D Gaussian Splatting (3DGS) `.ply` files. Featuring an OpenGL-based CPU rasterizer and interactive semantic labeling tools.

## Key Features

- **Splat Classification:** Paint semantic labels directly onto 3D splats using a brush or SAM (Segment Anything Model) integration.
- **Poly Delete (All Depth):** Select a polygon region in 2D to delete all splats behind that area through the entire depth of the scene.
- **Volume Box Tool:** Place a 3D bounding box by clicking on surfaces to bulk-classify or isolate specific volumetric regions.
- **SAM Integration:** Use Meta's Segment Anything Model via the Python backend to segment objects with a single click.
- **Undo/Redo:** Full support for undoing classification strokes.
- **COLMAP Support:** Import COLMAP camera orientations to view the scene from original capture points.

## Quick Start

### 1. Build the Application
Ensure you have CMake and a C++17 compiler (like MSVC) installed.
```bash
mkdir frontend/build
cd frontend/build
cmake ..
cmake --build . --config Release
```

### 2. Run the Backend (Optional - for SAM)
```bash
cd backend
pip install -r requirements.txt
python server.py
```

### 3. Usage
1. Launch `ArtisanGS_Classifier.exe`.
2. **Import Splat:** Load your `.ply` file.
3. **Tools:**
   - **Brush:** Paint class IDs onto splats.
   - **Poly Delete:** Click to define a polygon, then use "Delete Polygon Region (All Depth)" to clear that angle.
   - **Volume Box:** Click a point to place the box, use sliders to scale, and click "Classify Inside Box".
4. **Active Class:** Change the current label using the dropdown menu.
5. **Visibility:** Toggle class layers in the "Layers" panel.

## Technical Details

- **Frontend:** C++, OpenGL 3.3, ImGui, GLM.
- **Rasterizer:** Custom CPU-based splat rasterizer with ID mapping for pixel-perfect selection.
- **Backend:** Python, FastAPI, PyTorch (SAM).
