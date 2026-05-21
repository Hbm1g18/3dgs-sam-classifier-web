import React, { useState, useCallback, useRef, useEffect } from 'react';
import Viewer from './components/Viewer';
import { SplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { 
  Layers, 
  MousePointer2, 
  Eye, 
  EyeOff, 
  Loader2, 
  Upload, 
  CheckCircle2, 
  Info, 
  Maximize,
  Plus,
  Type,
  Trash2,
  Palette
} from 'lucide-react';

interface ClassInfo {
  id: number;
  name: string;
  color: string;
}

const INITIAL_CLASSES: ClassInfo[] = [
  { id: 0, name: 'Unlabeled', color: '#888888' },
  { id: 1, name: 'Class 1', color: '#ef4444' },
];

function App() {
  const [isSamMode, setIsSamMode] = useState(false);
  const [activeClass, setActiveClass] = useState(1);
  const [classes, setClasses] = useState<ClassInfo[]>(INITIAL_CLASSES);
  const [visibleClasses, setVisibleClasses] = useState<Set<number>>(new Set(INITIAL_CLASSES.map(c => c.id)));
  const [overlayIntensity, setOverlayIntensity] = useState(0.3);
  
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
  const originalColorRef = useRef<Float32Array | null>(null);

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

  const addClass = () => {
    const newId = classes.length > 0 ? Math.max(...classes.map(c => c.id)) + 1 : 1;
    const newClass: ClassInfo = {
        id: newId,
        name: `Class ${newId}`,
        color: `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`
    };
    setClasses([...classes, newClass]);
    setVisibleClasses(new Set([...Array.from(visibleClasses), newId]));
    setActiveClass(newId);
  };

  const renameClass = (id: number, newName: string) => {
    setClasses(classes.map(c => c.id === id ? { ...c, name: newName } : c));
  };

  const deleteClass = (id: number) => {
    if (id === 0) return; // Don't delete unlabeled
    setClasses(classes.filter(c => c.id !== id));
    const newVisible = new Set(visibleClasses);
    newVisible.delete(id);
    setVisibleClasses(newVisible);
    if (activeClass === id) setActiveClass(0);
    
    // Reset splats of this class back to 0
    if (classMapRef.current) {
        for (let i = 0; i < classMapRef.current.length; i++) {
            if (classMapRef.current[i] === id) classMapRef.current[i] = 0;
        }
        updateSplatVisibility();
    }
  };

  const updateSplatVisibility = useCallback(() => {
    const mesh = splatMeshRef.current;
    if (!mesh || !classMapRef.current || !originalOpacityRef.current || !originalColorRef.current) return;
    
    const data = mesh.packedSplats || (mesh as any).data;
    if (!data || typeof data.forEachSplat !== 'function') return;

    try {
        let changedCount = 0;
        const classMap = classMapRef.current;
        const originals = originalOpacityRef.current;
        const originalColors = originalColorRef.current;
        const classColors = new Map(classes.map(c => [c.id, new THREE.Color(c.color)]));
        
        const tempColor = new THREE.Color();

        data.forEachSplat((index, center, scales, quaternion, opacity, color) => {
            const classId = classMap[index];
            const isVisible = visibleClasses.has(classId);
            
            // 1. Calculate Target Opacity
            const targetOpacity = isVisible ? originals[index] : 0.0;
            
            // 2. Calculate Target Color (Original + Semantic Overlay)
            const baseR = originalColors[index * 3];
            const baseG = originalColors[index * 3 + 1];
            const baseB = originalColors[index * 3 + 2];
            
            const cColor = classColors.get(classId) || classColors.get(0)!;
            
            // Blend original color with class color based on intensity
            const targetR = baseR * (1 - overlayIntensity) + cColor.r * overlayIntensity;
            const targetG = baseG * (1 - overlayIntensity) + cColor.g * overlayIntensity;
            const targetB = baseB * (1 - overlayIntensity) + cColor.b * overlayIntensity;
            
            const opacityDiff = Math.abs(opacity - targetOpacity);
            const colorDiff = Math.abs(color.r - targetR) + Math.abs(color.g - targetG) + Math.abs(color.b - targetB);

            if (opacityDiff > 0.001 || colorDiff > 0.01) {
                if (typeof data.setSplat === 'function') {
                    tempColor.setRGB(targetR, targetG, targetB);
                    data.setSplat(index, center, scales, quaternion, targetOpacity, tempColor);
                    changedCount++;
                }
            }
        });
        
        if (changedCount > 0) {
            data.needsUpdate = true;
            console.log(`App: Splats updated. Changed: ${changedCount}`);
        }
    } catch (err) {
        console.error("App: Error during visibility update:", err);
    }
  }, [visibleClasses, classes, overlayIntensity]);

  const onSplatMeshLoaded = useCallback((mesh: SplatMesh) => {
    console.log("App: SplatMesh ready. numSplats:", mesh.numSplats);
    splatMeshRef.current = mesh;
    
    const count = mesh.numSplats;
    classMapRef.current = new Uint8Array(count);
    originalOpacityRef.current = new Float32Array(count);
    originalColorRef.current = new Float32Array(count * 3);
    
    const data = mesh.packedSplats || (mesh as any).data;
    if (data && typeof data.forEachSplat === 'function') {
        const originals = originalOpacityRef.current;
        const originalColors = originalColorRef.current;
        data.forEachSplat((index: number, _c: any, _s: any, _q: any, opacity: number, color: THREE.Color) => {
            originals[index] = opacity;
            originalColors[index * 3] = color.r;
            originalColors[index * 3 + 1] = color.g;
            originalColors[index * 3 + 2] = color.b;
        });
        console.log(`App: Captured metadata for ${count} splats.`);
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

    mesh.updateMatrixWorld(true);
    
    let modifiedCount = 0;
    try {
        data.forEachSplat((index: number, center: THREE.Vector3) => {
            vector.copy(center).applyMatrix4(mesh.matrixWorld).project(camera);
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

    console.log(`App: Projected to ${modifiedCount} splats`);
    updateSplatVisibility();
  };

  const toggleClassVisibility = (id: number) => {
    const newVisible = new Set(visibleClasses);
    if (newVisible.has(id)) newVisible.delete(id);
    else newVisible.add(id);
    setVisibleClasses(newVisible);
  };

  // Sync visibility
  useEffect(() => {
    if (isLoaded) {
        const timer = setTimeout(() => {
            updateSplatVisibility();
        }, 50);
        return () => clearTimeout(timer);
    }
  }, [isLoaded, visibleClasses, classes, overlayIntensity, updateSplatVisibility]);

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
      <div className="absolute top-6 left-6 flex flex-col gap-5 p-6 bg-neutral-900/90 rounded-2xl backdrop-blur-xl border border-white/10 w-80 shadow-2xl z-10 max-h-[90vh] overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Layers className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight leading-none">ArtisanGS</h1>
            <p className="text-[10px] text-neutral-500 mt-1 uppercase tracking-widest font-bold">Semantic Editor</p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider flex justify-between">
            1. Model 
            {stats && <span className="normal-case font-mono">{stats.count.toLocaleString()}</span>}
          </label>
          <div className="relative group">
            <input type="file" accept=".ply,.spz" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className="flex items-center justify-center gap-2 px-4 py-3 bg-neutral-800 rounded-xl border border-dashed border-neutral-600 group-hover:bg-neutral-700 group-hover:border-neutral-500 transition-all">      
              <Upload className="w-4 h-4 text-neutral-400" />
              <span className="text-sm font-medium text-neutral-300">Choose .ply / .spz</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">2. Tool</label>
          <div className="flex gap-2">
            <button onClick={() => setIsSamMode(!isSamMode)} className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold transition-all duration-200 active:scale-[0.98] ${isSamMode ? 'bg-blue-600 shadow-[0_0_30px_rgba(37,99,235,0.4)]' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}>
                <MousePointer2 className={`w-4 h-4 ${isSamMode ? 'animate-pulse' : ''}`} />
                {isSamMode ? 'SAM ACTIVE' : 'ENABLE SAM'}
            </button>
            <button onClick={() => setResetCounter(prev => prev + 1)} className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-all" title="Reset View">
                <Maximize className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="space-y-3 border-t border-white/5 pt-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">3. Classes</label>
            <button onClick={addClass} className="p-1.5 bg-blue-500 hover:bg-blue-400 rounded-lg transition-colors" title="Add Class">
                <Plus className="w-3 h-3 text-white" />
            </button>
          </div>
          
          <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
            {classes.map(c => (
              <div key={c.id} className={`group flex flex-col gap-2 p-3 rounded-xl border transition-all ${activeClass === c.id ? 'bg-neutral-800/80 border-blue-500/50' : 'bg-neutral-800/30 border-white/5 hover:border-white/10'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button 
                        onClick={() => setActiveClass(c.id)}
                        className={`w-4 h-4 rounded-full shadow-sm transition-transform ${activeClass === c.id ? 'scale-125 ring-2 ring-white/50' : 'hover:scale-110'}`} 
                        style={{ backgroundColor: c.color }} 
                    />
                    <input 
                        className="bg-transparent border-none focus:ring-0 text-sm font-medium text-neutral-200 p-0 w-32"
                        value={c.name}
                        onChange={(e) => renameClass(c.id, e.target.value)}
                        placeholder="Class Name"
                    />
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => toggleClassVisibility(c.id)} className="p-1 hover:bg-white/5 rounded">
                        {visibleClasses.has(c.id) ? <Eye className="w-3.5 h-3.5 text-neutral-400" /> : <EyeOff className="w-3.5 h-3.5 text-neutral-600" />}
                    </button>
                    {c.id !== 0 && (
                        <button onClick={() => deleteClass(c.id)} className="p-1 hover:bg-red-500/20 rounded group/del">
                            <Trash2 className="w-3.5 h-3.5 text-neutral-500 group-hover/del:text-red-400" />
                        </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t border-white/5 pt-4">
            <div className="flex items-center justify-between text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                <div className="flex items-center gap-2"><Palette className="w-3 h-3" /> Overlay</div>
                <span>{Math.round(overlayIntensity * 100)}%</span>
            </div>
            <input 
                type="range" min="0" max="1" step="0.05" 
                value={overlayIntensity} 
                onChange={(e) => setOverlayIntensity(parseFloat(e.target.value))}
                className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
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
        RENDERER: SPARKJS_V2 // MODE: DYNAMIC_SEMANTIC // OS: {window.navigator.platform}
      </div>
      
      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; } .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }`}</style>
    </div>
  );
}

export default App;
