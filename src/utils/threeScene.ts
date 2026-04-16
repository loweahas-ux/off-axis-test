import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { HeadPose } from './headPose';
import { OffAxisCamera } from './offAxisCamera';
import { calibrationManager, CalibrationData } from './calibration';

export interface ThreeSceneOptions {
  container: HTMLElement;
  width?: number;
  height?: number;
}

export class ThreeSceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private offAxisCamera: OffAxisCamera;
  private model: THREE.Object3D | null = null;
  private animationFrameId: number | null = null;
  private isRunning = false;
  private currentHeadPose: HeadPose = { x: 0.5, y: 0.5, z: 1 };
  private debugMode: boolean = false;
  private debugHelpers: THREE.Object3D[] = [];
  private roomObjects: THREE.Object3D[] = [];
  private torchLeft: THREE.PointLight | null = null;
  private torchRight: THREE.PointLight | null = null;

  constructor(options: ThreeSceneOptions) {
    const width = options.width || options.container.clientWidth;
    const height = options.height || options.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.z = 5;

    const calibration = calibrationManager.getCalibration();
    calibration.pixelWidth = width;
    calibration.pixelHeight = height;
    calibrationManager.updatePixelDimensions(width, height);

    this.offAxisCamera = new OffAxisCamera(this.camera, calibration);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    options.container.appendChild(this.renderer.domElement);

    this.createCenterObject();
    this.createEgyptianRoom();
    this.createDebugHelpers();
  }

  private createCenterObject(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
    this.scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight1.position.set(1, 1, 1);
    this.scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.1);
    directionalLight2.position.set(-1, -1, 0.5);
    this.scene.add(directionalLight2);

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    dracoLoader.setDecoderConfig({ type: 'js' });

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      '/models/nefertiti.glb',
      (gltf) => {
        this.model = gltf.scene;

        // Enhance material to look more majestic
        this.model.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mat = child.material as THREE.MeshStandardMaterial;
            mat.roughness = 0.4;
            mat.metalness = 0.6;
            // Add a subtle golden tint
            mat.color.setHex(0xffddaa);
          }
        });

        // The Nefertiti model may need specific positioning
        this.model.position.set(0, -0.05, 0); // slightly lowered
        this.model.rotation.set(0, Math.PI, 0); // face towards the user
        // Extremely small scale (0.008) is required for this particular model
        this.model.scale.set(0.008, 0.008, 0.008);
        this.scene.add(this.model);
      },
      undefined,
      (error) => {
        console.error('Error loading Nefertiti model:', error);
      }
    );
  }

  private createEgyptianRoom(): void {
    this.removeRoomObjects();

    const screenDims = this.offAxisCamera.getScreenDimensions();
    const roomWidth = screenDims.width;
    const roomHeight = screenDims.height;
    const roomDepth = 0.40;

    const textureLoader = new THREE.TextureLoader();

    // Load Sandstone Wall Texture
    const sandstoneTex = textureLoader.load('/media/sandstone.png');
    sandstoneTex.wrapS = THREE.RepeatWrapping;
    sandstoneTex.wrapT = THREE.RepeatWrapping;
    sandstoneTex.repeat.set(2, 2);

    const wallMaterial = new THREE.MeshStandardMaterial({
      map: sandstoneTex,
      roughness: 0.9,
      metalness: 0.1
    });

    // To restore spatial depth (공간감), we overlay an edge line to frame the room
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x331100, linewidth: 2, opacity: 0.5, transparent: true });

    const createWall = (width: number, height: number): THREE.Mesh => {
      const geom = new THREE.PlaneGeometry(width, height);
      const mesh = new THREE.Mesh(geom, wallMaterial);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom), lineMaterial);
      mesh.add(edges);
      return mesh;
    };

    const backWall = createWall(roomWidth, roomHeight);
    backWall.position.z = -roomDepth;
    this.scene.add(backWall);
    this.roomObjects.push(backWall);

    const leftWall = createWall(roomDepth, roomHeight);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.x = -roomWidth / 2;
    leftWall.position.z = -roomDepth / 2;
    this.scene.add(leftWall);
    this.roomObjects.push(leftWall);

    const rightWall = createWall(roomDepth, roomHeight);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.x = roomWidth / 2;
    rightWall.position.z = -roomDepth / 2;
    this.scene.add(rightWall);
    this.roomObjects.push(rightWall);

    const floor = createWall(roomWidth, roomDepth);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -roomHeight / 2;
    floor.position.z = -roomDepth / 2;
    this.scene.add(floor);
    this.roomObjects.push(floor);

    const ceiling = createWall(roomWidth, roomDepth);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = roomHeight / 2;
    ceiling.position.z = -roomDepth / 2;
    this.scene.add(ceiling);
    this.roomObjects.push(ceiling);

    // Egyptian Lotus/Papyrus Columns (Replaces plain Box pillars)
    const createEgyptianPillar = (): THREE.Group => {
      const group = new THREE.Group();
      const h = roomHeight;
      const startY = -h / 2;

      // Bottom Base (Square)
      const baseHeight = h * 0.05;
      const baseGeom = new THREE.BoxGeometry(0.064, baseHeight, 0.064);
      const baseMesh = new THREE.Mesh(baseGeom, wallMaterial);
      baseMesh.position.y = startY + baseHeight / 2;
      group.add(baseMesh);

      // Curved Shaft and Capital (Lathe)
      // Removed the center points (0.001) to prevent the vertex normals from pointing downwards/upwards at the seams, 
      // which was causing the dark shadow artifacts at the bottom and top.
      const points = [];
      points.push(new THREE.Vector2(0.028, startY + baseHeight)); // Bulge Out
      points.push(new THREE.Vector2(0.028, startY + h * 0.15));
      points.push(new THREE.Vector2(0.020, startY + h * 0.75));   // Taper in
      points.push(new THREE.Vector2(0.020, startY + h * 0.8));    // Neck
      points.push(new THREE.Vector2(0.032, startY + h * 0.85));   // Capital flare
      points.push(new THREE.Vector2(0.032, startY + h * 0.92));
      points.push(new THREE.Vector2(0.024, startY + h * 0.95));   // Restrict top

      const latheGeom = new THREE.LatheGeometry(points, 32);
      const latheMesh = new THREE.Mesh(latheGeom, wallMaterial);
      group.add(latheMesh);

      // Top Abacus (Square junction to ceiling)
      const abacusHeight = h * 0.05;
      const abacusGeom = new THREE.BoxGeometry(0.056, abacusHeight, 0.056);
      const abacusMesh = new THREE.Mesh(abacusGeom, wallMaterial);
      abacusMesh.position.y = (h / 2) - (abacusHeight / 2);
      group.add(abacusMesh);

      return group;
    };

    // Place the pillars slightly inset from the exact corners so they are fully visible
    const insetX = 0.04;
    const insetZ = 0.04;
    const positions = [
      [-roomWidth / 2 + insetX, -roomDepth + insetZ],
      [roomWidth / 2 - insetX, -roomDepth + insetZ],
      [-roomWidth / 2 + insetX, 0 - insetZ],
      [roomWidth / 2 - insetX, 0 - insetZ]
    ];
    positions.forEach(([x, z]) => {
      const p = createEgyptianPillar();
      p.position.set(x, 0, z);
      this.scene.add(p);
      this.roomObjects.push(p);
    });

    // Load Gold Texture for Altar
    const goldTex = textureLoader.load('/media/gold.png');
    const goldMaterial = new THREE.MeshStandardMaterial({
      map: goldTex,
      roughness: 0.3,
      metalness: 0.8,
      color: 0xffcc33
    });

    // Create Stepped Altar Layout
    const step1 = new THREE.Mesh(new THREE.BoxGeometry(roomWidth * 0.9, 0.05, 0.2), goldMaterial);
    step1.position.set(0, -roomHeight / 2 + 0.025, -roomDepth + 0.1);
    const step1Edges = new THREE.LineSegments(new THREE.EdgesGeometry(step1.geometry), lineMaterial);
    step1.add(step1Edges);
    this.scene.add(step1);
    this.roomObjects.push(step1);

    const step2 = new THREE.Mesh(new THREE.BoxGeometry(roomWidth * 0.6, 0.05, 0.1), goldMaterial);
    step2.position.set(0, -roomHeight / 2 + 0.075, -roomDepth + 0.05);
    const step2Edges = new THREE.LineSegments(new THREE.EdgesGeometry(step2.geometry), lineMaterial);
    step2.add(step2Edges);
    this.scene.add(step2);
    this.roomObjects.push(step2);

    // Warm Egyptian Torch Lights (Reddish-brown fire color, less saturated)
    // Placed slightly below the midline to illuminate the lower structures beautifully.
    this.torchLeft = new THREE.PointLight(0xb24a22, 1.0, 1.2);
    this.torchLeft.position.set(-roomWidth / 2.5, -0.02, 0.1);
    this.scene.add(this.torchLeft);
    this.roomObjects.push(this.torchLeft);

    this.torchRight = new THREE.PointLight(0xb24a22, 1.0, 1.2);
    this.torchRight.position.set(roomWidth / 2.5, -0.02, 0.1);
    this.scene.add(this.torchRight);
    this.roomObjects.push(this.torchRight);
  }

  private removeRoomObjects(): void {
    this.roomObjects.forEach(obj => {
      this.scene.remove(obj);
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    this.roomObjects = [];
  }

  private createDebugHelpers(): void {
    const axesHelper = new THREE.AxesHelper(0.1);
    axesHelper.visible = false;
    this.debugHelpers.push(axesHelper);
    this.scene.add(axesHelper);

    const headPositionMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff00ff })
    );
    headPositionMarker.visible = false;
    this.debugHelpers.push(headPositionMarker);
    this.scene.add(headPositionMarker);
  }

  updateHeadPose(headPose: HeadPose): void {
    this.currentHeadPose = headPose;
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    this.debugHelpers.forEach(helper => {
      helper.visible = enabled;
    });
  }

  updateCalibration(calibration: CalibrationData): void {
    this.offAxisCamera.updateCalibration(calibration);
    this.createEgyptianRoom();
  }

  updateModelPosition(x: number, y: number, z: number): void {
    if (this.model) {
      this.model.position.set(x, y, z);
    }
  }

  updateModelScale(scale: number): void {
    if (this.model) {
      this.model.scale.set(scale, scale, scale);
    }
  }

  getModelPosition(): { x: number; y: number; z: number } {
    if (this.model) {
      return {
        x: this.model.position.x,
        y: this.model.position.y,
        z: this.model.position.z
      };
    }
    return { x: 0, y: 0, z: 0 };
  }

  getModelScale(): number {
    if (this.model) {
      return this.model.scale.x;
    }
    return 0.1;
  }

  updateModelRotation(x: number, y: number, z: number): void {
    if (this.model) {
      this.model.rotation.set(x, y, z);
    }
  }

  getModelRotation(): { x: number; y: number; z: number } {
    if (this.model) {
      return {
        x: this.model.rotation.x,
        y: this.model.rotation.y,
        z: this.model.rotation.z
      };
    }
    return { x: 0, y: 0, z: 0 };
  }

  private animate = (): void => {
    if (!this.isRunning) return;

    this.animationFrameId = requestAnimationFrame(this.animate);

    this.offAxisCamera.updateFromHeadPose(this.currentHeadPose);

    // Apply flickering torch animation
    if (this.torchLeft && this.torchRight) {
      const time = Date.now() * 0.005;
      // Combine multiple sine waves for a chaotic, unpredictable flicker
      this.torchLeft.intensity = 1.0 + Math.sin(time) * 0.15 + Math.sin(time * 3.1) * 0.05;
      this.torchRight.intensity = 1.0 + Math.sin(time + 2.0) * 0.15 + Math.sin(time * 2.7) * 0.05;
    }

    if (this.debugMode && this.debugHelpers.length > 1) {
      const worldPos = this.offAxisCamera.headPoseToWorldPosition(this.currentHeadPose);
      this.debugHelpers[1].position.set(worldPos.x, worldPos.y, worldPos.z);
    }

    this.renderer.render(this.scene, this.camera);
  };

  start(): void {
    if (!this.isRunning) {
      this.isRunning = true;
      this.animate();
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    this.stop();

    if (this.model) {
      this.model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }

    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
