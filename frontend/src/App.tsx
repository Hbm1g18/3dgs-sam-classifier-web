import React, { useState, useCallback, useRef, useEffect } from 'react';
import Viewer from './components/Viewer';
import { SplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { Layers, MousePointer2, Eye, EyeOff, Loader2, Upload, CheckCircle2, Info, Maximize } from 'lucide-react';

const CLASSES = [
  { id: 0, name: 'Unlabeled', color: '#888888' },
  { id: 1, name: 'Class 1', color: '#ef4444' },
  { id: 2, name: 'Class 2', color: '#22c55e' },
  { id: 3, name: 'Class 3', color: '#3b82f6' },
  { id: 4, name: 'Class 4', color: '#eab308' },
];

function App() {
  const [isSamMode, setIsSamMode] = useState(false);
  const [activeClass, setActiveClass] = useState(1);
  const [visibleClasses, setVisibleClasses] = useState<Set<number>>(new Set(CLASSES.map(c => c.id)));
  const [status, setStatus] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<{ count: number } | null>(null);
  const [resetCounter, setResetCounter] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  const splatMeshRef = useRef<SplatMesh | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  
  // Non-destructive classification state
  const classMapRef = useRef<Uint8Array | null>(null);
  const originalOpacityRef = useRef<Float32Array | null>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      console.log("App: File selected ->", file.name);
      setIsLoaded(false);
      setStatus("Loading file...");
      const url = URL.createObjectURL(file);
      setFileUrl(url);
    }
  };

  const updateSplatVisibility = useCallback(() => {
    const mesh = splatMeshRef.current;
    if (!mesh || !classMapRef.current || !originalOpacityRef.current) return;
    
    const data = mesh.packedSplats || (mesh as any).data;
    if (!data || typeof data.forEachSplat !== 'function') return;

    try {
        console.log(`App: Visibility update triggered. Visible classes:`, Array.from(visibleClasses));
        let hiddenCount = 0;
        let changedCount = 0;
        const classMap = classMapRef.current;
        const originals = originalOpacityRef.current;

        data.forEachSplat((index, center, scales, quaternion, opacity, color) => {
            const classId = classMap[index];
            const isVisible = visibleClasses.has(classId);
            
            // Current target opacity based on user selection
            const targetOpacity = isVisible ? originals[index] : 0.0;
            
            if (Math.abs(opacity - targetOpacity) > 0.001) {
                if (typeof data.setSplat === 'function') {
                    data.setSplat(index, center, scales, quaternion, targetOpacity, color);
                    changedCount++;
                }
            }
            if (targetOpacity < 0.001) hiddenCount++;
        });
        
        if (changedCount > 0) {
            data.needsUpdate = true;
        }
        console.log(`App: Visibility update done. Total: ${mesh.numSplats}, Hidden: ${hiddenCount}, Changed: ${changedCount}`);
    } catch (err) {
        console.error("App: Error during visibility update:", err);
    }
  }, [visibleClasses]);

  const onSplatMeshLoaded = useCallback((mesh: SplatMesh) => {
    console.log("App: SplatMesh ready. numSplats:", mesh.numSplats);
    splatMeshRef.current = mesh;
    
    // Initialize our classification and opacity buffers
    const count = mesh.numSplats;
    classMapRef.current = new Uint8Array(count);
    originalOpacityRef.current = new Float32Array(count);
    
    // Capture original opacities from the model
    const data = mesh.packedSplats || (mesh as any).data;
    if (data && typeof data.forEachSplat === 'function') {
        const originals = originalOpacityRef.current;
        let sumOpacity = 0;
        data.forEachSplat((index: number, _c: any, _s: any, _q: any, opacity: number) => {
            originals[index] = opacity;
            sumOpacity += opacity;
        });
        console.log(`App: Captured originals. Avg opacity: ${sumOpacity / count}`);
    }

    setStats({ count });
    setStatus("Model loaded successfully");
    setTimeout(() => setStatus(null), 3000);
    setResetCounter(prev => prev + 1);
    setIsLoaded(true);
  }, []);

  const onCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    canvasRef.current = canvas;
  }, []);

  const onCameraUpdate = useCallback((camera: THREE.PerspectiveCamera) => {
    cameraRef.current = camera;
  }, []);

  const handleSplatClick = async (x: number, y: number) => {
    if (!canvasRef.current || !splatMeshRef.current || !isLoaded || (status && status.includes("..."))) return;

    setStatus("Capturing view...");
    try {
      const blob = await new Promise<Blob | null>(resolve => 
        canvasRef.current?.toBlob(resolve, 'image/png')
      );
      if (!blob) throw new Error("Failed to capture canvas");

      setStatus("Segmenting with SAM...");
      const formData = new FormData();
      formData.append('image', blob, 'capture.png');
      formData.append('x', Math.round(x).toString());
      formData.append('y', Math.round(y).toString());

      const response = await fetch('http://localhost:8000/segment', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend Error: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      setStatus("Projecting to 3D...");
      await applyMaskToSplats(data.mask);
      
      setStatus("Classification applied!");
      setTimeout(() => setStatus(null), 2000);

    } catch (error) {
      console.error(error);
      setStatus("Error: " + (error instanceof Error ? error.message : "Failed"));
      setTimeout(() => setStatus(null), 5000);
    }
  };

  const applyMaskToSplats = async (maskUrl: string) => {
    const mesh = splatMeshRef.current;
    if (!mesh || !classMapRef.current || !cameraRef.current || !canvasRef.current || !originalOpacityRef.current) return;

    const data = mesh.packedSplats || (mesh as any).data;
    if (!data || typeof data.forEachSplat !== 'function') return;

    const maskImg = new Image();
    maskImg.src = maskUrl;
    await new Promise((resolve) => (maskImg.onload = resolve));

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = maskImg.width;
    maskCanvas.height = maskImg.height;
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(maskImg, 0, 0);
    const maskData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;

    const camera = cameraRef.current;
    const classMap = classMapRef.current;
    
    const vector = new THREE.Vector3();
    const width = maskCanvas.width;
    const height = maskCanvas.height;

    // Critical: Ensure world matrices are fresh, especially since rotation was applied
    mesh.updateMatrixWorld(true);
    
    let modifiedCount = 0;
    let totalProcessed = 0;
    try {
        data.forEachSplat((index: number, center: THREE.Vector3) => {
            totalProcessed++;
            vector.copy(center).applyMatrix4(mesh.matrixWorld).project(camera);

            // Check if point is within camera frustum
            if (vector.z < -1 || vector.z > 1) return;

            const px = Math.round((vector.x + 1) * width / 2);
            const py = Math.round((-vector.y + 1) * height / 2);

            if (px >= 0 && px < width && py >= 0 && py < height) {
                const maskIdx = (py * width + px) * 4;
                if (maskData[maskIdx] > 128) {
                    classMap[index] = activeClass;
                    modifiedCount++;
                }
            }
        });
    } catch (err) {
        console.error("App: Error during projection:", err);
    }

    console.log(`App: Projection complete. Processed: ${totalProcessed}, Modified: ${modifiedCount}`);
    updateSplatVisibility();
  };

  const toggleClassVisibility = (id: number) => {
    console.log(`App: Toggling class visibility for ID ${id}`);
    const newVisible = new Set(visibleClasses);
    if (newVisible.has(id)) newVisible.delete(id);
    else newVisible.add(id);
    setVisibleClasses(newVisible);
  };

  // Trigger visibility update when layers change or mesh is loaded
  useEffect(() => {
    if (isLoaded) {
        // Delay update slightly to give the renderer room to breathe
        const timer = setTimeout(() => {
            updateSplatVisibility();
        }, 100);
        return () => clearTimeout(timer);
    }
  }, [isLoaded, visibleClasses, updateSplatVisibility]);

  return (
    <div className="relative w-full h-screen bg-neutral-950 text-white overflow-hidden font-sans">
      <Viewer 
        onSplatMeshLoaded={onSplatMeshLoaded} 
        onCanvasReady={onCanvasReady}
        onSplatClick={handleSplatClick}
        isSamMode={isSamMode}
        onCameraUpdate={onCameraUpdate}
        fileUrl={fileUrl}
        resetCounter={resetCounter}
      />

      {/* SIDEBAR */}
      <div className="absolute top-6 left-6 flex flex-col gap-6 p-6 bg-neutral-900/90 rounded-2xl backdrop-blur-xl border border-white/10 w-80 shadow-2xl z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Layers className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight leading-none">ArtisanGS Web</h1>
            <p className="text-[10px] text-neutral-500 mt-1 uppercase tracking-widest font-bold">Semantic 3DGS Editor</p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">1. Load Model</label>
          <div className="relative group">
            <input type="file" accept=".ply,.spz" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className="flex items-center justify-center gap-2 px-4 py-3 bg-neutral-800 rounded-xl border border-dashed border-neutral-600 group-hover:bg-neutral-700 group-hover:border-neutral-500 transition-all">
              <Upload className="w-4 h-4 text-neutral-400" />
              <span className="text-sm font-medium text-neutral-300">Choose .ply / .spz</span>
            </div>
          </div>
          {stats && (
            <div className="flex items-center gap-2 text-[10px] text-neutral-500 bg-black/20 p-2 rounded-lg">
               <Info className="w-3 h-3" />
               Loaded {stats.count.toLocaleString()} Gaussians
            </div>
          )}
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">2. Select Tool</label>
          <div className="flex gap-2">
            <button onClick={() => setIsSamMode(!isSamMode)} className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold transition-all duration-200 active:scale-[0.98] ${isSamMode ? 'bg-blue-600 shadow-[0_0_30px_rgba(37,99,235,0.4)]' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}>
                <MousePointer2 className={`w-4 h-4 ${isSamMode ? 'animate-pulse' : ''}`} />
                {isSamMode ? 'SAM ACTIVE' : 'ENABLE SAM'}
            </button>
            <button 
                onClick={() => setResetCounter(prev => prev + 1)}
                className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-all"
                title="Reset View"
            >
                <Maximize className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">3. Current Label</label>
          <div className="grid grid-cols-4 gap-3">
            {CLASSES.slice(1).map(c => (
              <button key={c.id} onClick={() => setActiveClass(c.id)} className={`aspect-square rounded-full border-2 transition-all duration-200 hover:scale-110 active:scale-90 ${activeClass === c.id ? 'border-white ring-4 ring-white/10' : 'border-transparent opacity-60'}`} style={{ backgroundColor: c.color }} title={c.name} />
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t border-white/5 pt-4">
          <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Visibility Layers</label>
          <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
            {CLASSES.map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 bg-neutral-800/30 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                <div className="flex items-center gap-3"><div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: c.color }} /><span className="text-sm font-medium text-neutral-200">{c.name}</span></div>
                <button onClick={() => toggleClassVisibility(c.id)}>{visibleClasses.has(c.id) ? <Eye className="w-4 h-4 text-neutral-400" /> : <EyeOff className="w-4 h-4 text-neutral-600" />}</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {status && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-3 px-6 py-3 bg-blue-600/90 backdrop-blur-md rounded-full border border-white/20 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
            {status.includes("Error") ? <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse" /> : status.includes("successfully") || status.includes("applied") ? <CheckCircle2 className="w-5 h-5 text-white" /> : <Loader2 className="w-5 h-5 text-white animate-spin" />}
            <span className="text-sm font-bold tracking-wide uppercase">{status}</span>
          </div>
        </div>
      )}

      <div className="absolute bottom-6 left-6 text-[10px] text-neutral-500 font-mono tracking-tighter opacity-50 z-10 pointer-events-none">
        RENDERER: SPARKJS_V2 // BACKEND: SAM_VIT_B // OS: {window.navigator.platform}
      </div>
      
      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; } .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }`}</style>
    </div>
  );
}

export default App;
