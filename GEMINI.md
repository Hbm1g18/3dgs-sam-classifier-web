# Project Instructions: ArtisanGS Classifier

## Architecture Overview

- **`frontend/src/main.cpp`**: Main application loop, UI logic, and tool implementations.
- **`frontend/src/CPURasterizer.cpp`**: CPU-based splat rendering. Uses an `orientationFix` (180-degree rotation on X) to align typical 3DGS coordinate systems with OpenGL.
- **`frontend/src/SplatModel.cpp`**: Manages the Gaussian data, including loading/saving classification IDs and opacity.

## Tool Implementation Mandates

### Coordinate Transformations
When implementing selection tools (like PolyDelete or BoxSelect), **always** apply the `orientationFix` to the projection matrix to match the renderer:
```cpp
glm::mat4 orientationFix = glm::scale(glm::mat4(1.0f), glm::vec3(1.0f, -1.0f, -1.0f));
glm::mat4 viewProj = projectionMatrix * viewMatrix * orientationFix;
```

### Selection Logic
- **2D Tools (Brush, SAM):** Use the `idMap` from `CPURasterizer` to identify the specific Gaussian index under a pixel.
- **3D Tools (Volume Box, Poly Delete All Depth):** Iterate through the `SplatModel` gaussians directly and project them into NDC/Screen space for testing.

## Conventions

- **Class IDs:** 0 is always "Unlabeled" or "Eraser".
- **Undo System:** Store changes as `std::vector<std::pair<int, int>>` (index, previous_class_id) in `UndoStroke`.
- **UI:** Keep tool-specific controls inside the "Inspector & Tools" panel. Use `ImGui::RadioButton` for mode switching.
