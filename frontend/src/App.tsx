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
  Trash2,
  Palette,
  MousePointerClick,
  Type as TypeIcon,
  Play,
  RotateCcw,
  Move,
  Brush
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

type ToolMode = 'NAV' | 'SINGLE' | 'MULTI' | 'TEXT' | 'BRUSH';

function App() {
  const [toolMode, setToolMode] = useState<ToolMode>('NAV');
  const [activeClass, setActiveClass] = useState(1);
  const [classes, setClasses] = useState<ClassInfo[]>(INITIAL_CLASSES);
  const [visibleClasses, setVisibleClasses] = useState<Set<number>>(new Set(INITIAL_CLASSES.map(c => c.id)));
  const [overlayIntensity, setOverlayIntensity] = useState(0.3);
  
  const [status, setStatus] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<{ count: number } | null>(null);
  const [resetCounter, setResetCounter] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  // Tool specific state
  const [multiPoints, setMultiPoints] = useState<{x: number, y: number}[]>([]);
  const [textPrompt, setTextPrompt] = useState("");
  const [brushSize, setBrushSize] = useState(30);

  const splatMeshRef = useRef<SplatMesh | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const classMapRef = useRef<Uint8Array | null>(null);
  const originalOpacityRef = useRef<Float32Array | null>(null);
  const originalColorRef = useRef<Float32Array | null>(null);

  // Hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === '1') setToolMode('SINGLE');
      if (e.key === '2') { setToolMode('MULTI'); setMultiPoints([]); }
      if (e.key === '3') setToolMode('TEXT');
      if (e.key === '4') setToolMode('BRUSH');
      if (e.key === 'Escape') setToolMode('NAV');
    };
    const handleContextMenu = (e: MouseEvent) => {
      if (toolMode !== 'NAV') { e.preventDefault(); setToolMode('NAV'); }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('contextmenu', handleContextMenu);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [toolMode]);

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
    if (id === 0) return;
    setClasses(classes.filter(c => c.id !== id));
    const newVisible = new Set(visibleClasses);
    newVisible.delete(id);
    setVisibleClasses(newVisible);
    if (activeClass === id) setActiveClass(0);
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
            const targetOpacity = isVisible ? originals[index] : 0.0;
            const baseR = originalColors[index * 3];
            const baseG = originalColors[index * 3 + 1];
            const baseB = originalColors[index * 3 + 2];
            const cColor = classColors.get(classId) || classColors.get(0)!;
            const targetR = baseR * (1 - overlayIntensity) + cColor.r * overlayIntensity;
            const targetG = baseG * (1 - overlayIntensity) + cColor.g * overlayIntensity;
            const targetB = baseB * (1 - overlayIntensity) + cColor.b * overlayIntensity;
            
            if (Math.abs(opacity - targetOpacity) > 0.001 || Math.abs(color.r - targetR) > 0.01) {
                if (typeof data.setSplat === 'function') {
                    tempColor.setRGB(targetR, targetG, targetB);
                    data.setSplat(index, center, scales, quaternion, targetOpacity, tempColor);
                    changedCount++;
                }
            }
        });
        if (changedCount > 0) data.needsUpdate = true;
    } catch (err) {
        console.error("App: Error during visibility update:", err);
    }
  }, [visibleClasses, classes, overlayIntensity]);

  const onSplatMeshLoaded = useCallback((mesh: SplatMesh) => {
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

  const handleSplatClick = (x: number, y: number) => {
    if (toolMode === 'SINGLE') {
        executeSegmentation({ x: [x], y: [y] });
    } else if (toolMode === 'MULTI') {
        setMultiPoints([...multiPoints, { x, y }]);
    }
  };

  const executeSegmentation = async (params: { x?: number[], y?: number[], text?: string }) => {
    if (!canvasRef.current || !splatMeshRef.current || !isLoaded) return;
    setStatus("Capturing view...");
    try {
      const blob = await new Promise<Blob | null>(resolve => 
        canvasRef.current?.toBlob(resolve, 'image/png')
      );
      if (!blob) throw new Error("Failed to capture canvas");
      setStatus(params.text ? "Segmenting with Text..." : "Segmenting with SAM...");
      const formData = new FormData();
      formData.append('image', blob, 'capture.png');
      if (params.x && params.y) {
          formData.append('x', JSON.stringify(params.x));
          formData.append('y', JSON.stringify(params.y));
      }
      if (params.text) {
          formData.append('text_prompt', params.text);
      }
      const response = await fetch('http://localhost:8000/segment', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setStatus("Projecting to 3D...");
      await applyMaskToSplats(data.mask);
      setStatus("Success!");
      setTimeout(() => setStatus(null), 2000);
      setMultiPoints([]);
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
                }
            }
        });
    } catch (err) {
        console.error("App: Error during projection:", err);
    }
    updateSplatVisibility();
  };

  const toggleClassVisibility = (id: number) => {
    const newVisible = new Set(visibleClasses);
    if (newVisible.has(id)) newVisible.delete(id);
    else newVisible.add(id);
    setVisibleClasses(newVisible);
  };

  useEffect(() => {
    if (isLoaded) {
        const timer = setTimeout(() => updateSplatVisibility(), 50);
        return () => clearTimeout(timer);
    }
  }, [isLoaded, visibleClasses, classes, overlayIntensity, updateSplatVisibility]);

  // BRUSH LOGIC
  const [isBrushing, setIsBrushing] = useState(false);
  const lastBrushPos = useRef<{x: number, y: number} | null>(null);

  const startBrush = (e: React.MouseEvent) => {
      if (toolMode !== 'BRUSH') return;
      setIsBrushing(true);
      const canvas = brushCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      lastBrushPos.current = { x, y };
  };

  const drawBrush = (e: React.MouseEvent) => {
      if (!isBrushing || toolMode !== 'BRUSH' || !brushCanvasRef.current) return;
      const canvas = brushCanvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'white';
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (lastBrushPos.current) ctx.moveTo(lastBrushPos.current.x, lastBrushPos.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      lastBrushPos.current = { x, y };
  };

  const endBrush = async () => {
      if (!isBrushing || toolMode !== 'BRUSH') return;
      setIsBrushing(false);
      lastBrushPos.current = null;
      if (!brushCanvasRef.current) return;
      
      setStatus("Projecting brush...");
      await applyMaskToSplats(brushCanvasRef.current.toDataURL());
      
      const ctx = brushCanvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, brushCanvasRef.current.width, brushCanvasRef.current.height);
      setStatus(null);
  };

  return (
    <div className="relative w-full h-screen bg-neutral-950 text-white overflow-hidden font-sans">
      <Viewer 
        onSplatMeshLoaded={onSplatMeshLoaded} 
        onCanvasReady={onCanvasReady}
        onSplatClick={handleSplatClick}
        isSamMode={toolMode !== 'NAV'}
        onCameraUpdate={onCameraUpdate}
        fileUrl={fileUrl}
        resetCounter={resetCounter}
      />

      <canvas 
        ref={brushCanvasRef}
        className={`absolute inset-0 z-20 pointer-events-none ${toolMode === 'BRUSH' ? 'opacity-50' : 'opacity-0'}`}
        width={window.innerWidth}
        height={window.innerHeight}
      />

      {toolMode === 'BRUSH' && (
          <div 
            className="absolute inset-0 z-30 cursor-crosshair"
            onMouseDown={startBrush}
            onMouseMove={drawBrush}
            onMouseUp={endBrush}
            onMouseLeave={endBrush}
          />
      )}

      {toolMode === 'MULTI' && multiPoints.length > 0 && (
          <div className="absolute inset-0 pointer-events-none z-20">
              {multiPoints.map((p, i) => (
                  <div key={i} className="absolute w-3 h-3 bg-blue-500 rounded-full border-2 border-white -translate-x-1/2 -translate-y-1/2 shadow-lg" style={{ left: p.x, top: p.y }} />
              ))}
          </div>
      )}

      <div className="absolute top-6 left-6 flex flex-col gap-5 p-6 bg-neutral-900/90 rounded-2xl backdrop-blur-xl border border-white/10 w-80 shadow-2xl z-10 max-h-[90vh] overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-lg"><Layers className="w-6 h-6 text-blue-400" /></div>
          <div>
            <h1 className="text-xl font-bold tracking-tight leading-none">ArtisanGS</h1>
            <p className="text-[10px] text-neutral-500 mt-1 uppercase tracking-widest font-bold">Semantic Editor</p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider flex justify-between">1. Model {stats && <span className="normal-case font-mono">{stats.count.toLocaleString()}</span>}</label>
          <div className="relative group">
            <input type="file" accept=".ply,.spz" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className="flex items-center justify-center gap-2 px-4 py-3 bg-neutral-800 rounded-xl border border-dashed border-neutral-600 group-hover:bg-neutral-700 group-hover:border-neutral-500 transition-all">      
              <Upload className="w-4 h-4 text-neutral-400" /><span className="text-sm font-medium text-neutral-300">Choose Splat</span>
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-white/5 pt-4">
          <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">2. Tools</label>
          <div className="grid grid-cols-5 gap-1.5">
            <button onClick={() => setToolMode('NAV')} className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${toolMode === 'NAV' ? 'bg-blue-600' : 'bg-neutral-800 text-neutral-400'}`} title="NAV (Esc)"><Move className="w-3.5 h-3.5" /><span className="text-[7px] font-bold">NAV</span></button>
            <button onClick={() => setToolMode('SINGLE')} className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${toolMode === 'SINGLE' ? 'bg-blue-600' : 'bg-neutral-800 text-neutral-400'}`} title="SAM (1)"><MousePointer2 className="w-3.5 h-3.5" /><span className="text-[7px] font-bold">SAM</span></button>
            <button onClick={() => { setToolMode('MULTI'); setMultiPoints([]); }} className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${toolMode === 'MULTI' ? 'bg-blue-600' : 'bg-neutral-800 text-neutral-400'}`} title="MULTI (2)"><MousePointerClick className="w-3.5 h-3.5" /><span className="text-[7px] font-bold">MULTI</span></button>
            <button onClick={() => setToolMode('TEXT')} className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${toolMode === 'TEXT' ? 'bg-blue-600' : 'bg-neutral-800 text-neutral-400'}`} title="TEXT (3)"><TypeIcon className="w-3.5 h-3.5" /><span className="text-[7px] font-bold">TEXT</span></button>
            <button onClick={() => setToolMode('BRUSH')} className={`p-2 rounded-lg flex flex-col items-center gap-1 transition-all ${toolMode === 'BRUSH' ? 'bg-blue-600' : 'bg-neutral-800 text-neutral-400'}`} title="BRUSH (4)"><Brush className="w-3.5 h-3.5" /><span className="text-[7px] font-bold">BRUSH</span></button>
          </div>

          {toolMode === 'MULTI' && (
              <div className="flex gap-2"><button onClick={() => executeSegmentation({ x: multiPoints.map(p => p.x), y: multiPoints.map(p => p.y) })} className="flex-1 py-2 bg-green-600 rounded-lg text-xs font-bold">RUN ({multiPoints.length})</button><button onClick={() => setMultiPoints([])} className="p-2 bg-neutral-800 rounded-lg"><RotateCcw className="w-3 h-3" /></button></div>
          )}
          {toolMode === 'TEXT' && (
              <div className="flex gap-2"><input className="flex-1 bg-neutral-800 border-none rounded-lg text-xs px-3 text-white" placeholder="e.g. Church" value={textPrompt} onChange={(e) => setTextPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && executeSegmentation({ text: textPrompt })} /><button onClick={() => executeSegmentation({ text: textPrompt })} className="p-2 bg-blue-600 rounded-lg"><Play className="w-3 h-3" /></button></div>
          )}
          {toolMode === 'BRUSH' && (
              <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-bold text-neutral-500 uppercase"><span>Size</span><span>{brushSize}px</span></div>
                  <input type="range" min="5" max="200" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
              </div>
          )}
        </div>

        <div className="space-y-3 border-t border-white/5 pt-4">
          <div className="flex items-center justify-between"><label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">3. Classes</label><button onClick={addClass} className="p-1.5 bg-blue-500 rounded-lg"><Plus className="w-3 h-3 text-white" /></button></div>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
            {classes.map(c => (
              <div key={c.id} className={`group flex flex-col gap-2 p-2.5 rounded-xl border transition-all ${activeClass === c.id ? 'bg-neutral-800 border-blue-500/50 shadow-lg' : 'bg-neutral-800/30 border-white/5 hover:border-white/10'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setActiveClass(c.id)} className={`w-3.5 h-3.5 rounded-full ${activeClass === c.id ? 'scale-125 ring-2 ring-white/50' : ''}`} style={{ backgroundColor: c.color }} />
                    <input className="bg-transparent border-none focus:ring-0 text-xs font-bold text-neutral-200 p-0 w-32" value={c.name} onChange={(e) => renameClass(c.id, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => toggleClassVisibility(c.id)} className="p-1 hover:bg-white/5 rounded">{visibleClasses.has(c.id) ? <Eye className="w-3 h-3 text-neutral-400" /> : <EyeOff className="w-3 h-3 text-neutral-600" />}</button>
                    {c.id !== 0 && <button onClick={() => deleteClass(c.id)} className="p-1 hover:bg-red-500/20 rounded group/del"><Trash2 className="w-3 h-3 text-neutral-500 group-hover/del:text-red-400" /></button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t border-white/5 pt-4">
            <div className="flex items-center justify-between text-[10px] font-bold text-neutral-500 uppercase"><span>Overlay Intensity</span><span>{Math.round(overlayIntensity * 100)}%</span></div>
            <input type="range" min="0" max="1" step="0.05" value={overlayIntensity} onChange={(e) => setOverlayIntensity(parseFloat(e.target.value))} className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
        </div>

        <button onClick={() => setResetCounter(prev => prev + 1)} className="mt-2 flex items-center justify-center gap-2 w-full py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"><Maximize className="w-3 h-3" /> Reset Camera</button>
      </div>

      {status && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-3 px-6 py-3 bg-blue-600/90 backdrop-blur-md rounded-full border border-white/20 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
            {status.includes("Error") ? <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse" /> : status.includes("successfully") || status.includes("Success") ? <CheckCircle2 className="w-5 h-5 text-white" /> : <Loader2 className="w-5 h-5 text-white animate-spin" />}
            <span className="text-sm font-bold tracking-wide uppercase">{status}</span>
          </div>
        </div>
      )}

      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; } .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }`}</style>
    </div>
  );
}

export default App;
