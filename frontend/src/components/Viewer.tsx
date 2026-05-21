import React, { useEffect, useRef } from 'react';
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

  // Initialize Core Three.js
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    sceneRef.current = scene;
    
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 50000);
    camera.position.set(0, 10, 50);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ 
        antialias: false,
        preserveDrawingBuffer: true,
        alpha: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    onCanvasReady(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;

    scene.add(new THREE.GridHelper(100, 100, 0x333333, 0x222222));
    scene.add(new THREE.AxesHelper(10));

    // Initialize Spark
    const spark = new SparkRenderer({ renderer, sortRadial: false });
    scene.add(spark);
    sparkRef.current = spark;

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      onCameraUpdate(camera);
    };
    renderer.setAnimationLoop(animate);

    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      console.log("Viewer: Cleanup");
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', handleResize);
      spark.dispose?.();
      renderer.dispose();
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      sparkRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  // Handle Loading
  useEffect(() => {
    const scene = sceneRef.current;
    if (!fileUrl || !scene) return;

    if (currentSplatRef.current) {
        scene.remove(currentSplatRef.current);
        currentSplatRef.current.dispose?.();
    }

    console.log("Viewer: Loading ->", fileUrl);
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
  }, [fileUrl, onSplatMeshLoaded]);

  // Handle Camera Reset
  useEffect(() => {
    if (resetCounter > 0 && cameraRef.current && controlsRef.current && currentSplatRef.current) {
        console.log("Viewer: Manual Camera Reset");
        const mesh = currentSplatRef.current;
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
            const distance = maxDim / (2 * Math.tan(Math.PI * cameraRef.current.fov / 360));
            cameraRef.current.position.set(center.x, center.y + (maxDim * 0.2), center.z + distance * 1.5);
            controlsRef.current.target.copy(center);
            controlsRef.current.update();
        }
    }
  }, [resetCounter]);

  // Handle SAM Click Handler
  const clickHandlerRef = useRef(onSplatClick);
  useEffect(() => { clickHandlerRef.current = onSplatClick; }, [onSplatClick]);
  useEffect(() => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;
    const onMouseDown = (event: MouseEvent) => {
        if (!isSamMode) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        clickHandlerRef.current(x, y);
    };
    canvas.addEventListener('mousedown', onMouseDown);
    return () => canvas.removeEventListener('mousedown', onMouseDown);
  }, [isSamMode]);

  return <div ref={containerRef} className="w-full h-screen bg-black" />;
};

export default Viewer;
