import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

interface ViewerProps {
  onSplatMeshLoaded: (mesh: SplatMesh) => void;
  onCanvasReady: (canvas: HTMLCanvasElement) => void;
  onSplatClick: (x: number, y: number) => void;
  isSamMode: boolean;
  onCameraUpdate: (camera: THREE.PerspectiveCamera) => void;
  fileUrl: string | null;
  resetCounter: number;
}

const Viewer: React.FC<ViewerProps> = ({ 
  onSplatMeshLoaded, 
  onCanvasReady, 
  onSplatClick, 
  isSamMode,
  onCameraUpdate,
  fileUrl,
  resetCounter
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const currentSplatRef = useRef<SplatMesh | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sparkRef = useRef<SparkRenderer | null>(null);
  
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    
    // Ensure clean state
    containerRef.current.innerHTML = '';
    console.log("Viewer: [1/6] Atomic Initialization...");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    sceneRef.current = scene;
    
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);
    camera.position.set(0, 30, 100);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ 
        antialias: false,
        preserveDrawingBuffer: true,
        alpha: false,
        powerPreference: "high-performance"
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    onCanvasReady(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    scene.add(new THREE.GridHelper(200, 100, 0x444444, 0x222222));
    scene.add(new THREE.AxesHelper(20));

    // Initialize Spark with autoUpdate false to prevent async crashes
    let spark: SparkRenderer | null = null;
    try {
        spark = new SparkRenderer({ 
            renderer, 
            sortRadial: false, 
            autoUpdate: false // Manual update to avoid background 'No target' errors
        });
        scene.add(spark);
        sparkRef.current = spark;
    } catch (e) {
        console.error("Viewer: Spark Init Error", e);
    }

    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      
      if (controls) controls.update();
      
      // Manually drive Spark update
      if (spark) {
          spark.update({ scene, camera });
      }
      
      renderer.render(scene, camera);
      onCameraUpdate(camera);
    };
    animate();

    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    setIsReady(true);

    return () => {
      console.log("Viewer: Disposing...");
      setIsReady(false);
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      
      if (spark) {
          scene.remove(spark);
          spark.dispose?.();
      }
      
      if (controls) controls.dispose();
      renderer.dispose();
      
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      
      sparkRef.current = null;
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  // Handle Model Loading
  useEffect(() => {
    if (!isReady || !fileUrl || !sceneRef.current) return;

    const scene = sceneRef.current;
    if (currentSplatRef.current) {
        scene.remove(currentSplatRef.current);
        currentSplatRef.current.dispose?.();
    }

    console.log("Viewer: Loading model ->", fileUrl);
    const splatMesh = new SplatMesh({ url: fileUrl });
    splatMesh.rotation.x = Math.PI; 
    scene.add(splatMesh);
    currentSplatRef.current = splatMesh;

    const checkInterval = setInterval(() => {
        if (splatMesh.numSplats > 0) {
            console.log("Viewer: Splat Ready. count:", splatMesh.numSplats);
            clearInterval(checkInterval);
            onSplatMeshLoaded(splatMesh);
        }
    }, 500);

    return () => {
        clearInterval(checkInterval);
        if (splatMesh) {
            scene.remove(splatMesh);
            splatMesh.dispose?.();
        }
    };
  }, [isReady, fileUrl, onSplatMeshLoaded]);

  // Handle Camera Reset
  useEffect(() => {
    if (isReady && resetCounter > 0 && cameraRef.current && controlsRef.current && currentSplatRef.current) {
        const mesh = currentSplatRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        
        console.log("Viewer: Resetting view...");
        mesh.updateMatrixWorld(true);
        const box = new THREE.Box3();
        const vec = new THREE.Vector3();
        
        const step = Math.max(1, Math.floor(mesh.numSplats / 2000));
        mesh.forEachSplat((index, center) => {
            if (index % step === 0) {
                vec.copy(center).applyMatrix4(mesh.matrixWorld);
                box.expandByPoint(vec);
            }
        });

        if (!box.isEmpty()) {
            const center = new THREE.Vector3();
            box.getCenter(center);
            const size = new THREE.Vector3();
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z);
            const distance = maxDim / (2 * Math.tan(Math.PI * camera.fov / 360));
            
            camera.position.set(center.x, center.y + (maxDim * 0.2), center.z + distance * 1.5);
            controls.target.copy(center);
            controls.update();
        }
    }
  }, [isReady, resetCounter]);

  // Handle SAM Click Handler
  useEffect(() => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;
    
    const onMouseDown = (event: MouseEvent) => {
        if (!isSamMode) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        onSplatClick(x, y);
    };
    canvas.addEventListener('mousedown', onMouseDown);
    return () => canvas.removeEventListener('mousedown', onMouseDown);
  }, [isSamMode, onSplatClick]);

  return <div ref={containerRef} className="w-full h-screen bg-neutral-900 overflow-hidden" />;
};

export default Viewer;
