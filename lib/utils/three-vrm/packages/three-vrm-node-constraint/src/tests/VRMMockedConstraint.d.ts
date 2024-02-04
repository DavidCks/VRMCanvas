import * as THREE from 'three';
import { VRMNodeConstraint } from '../VRMNodeConstraint';
export declare class VRMMockedConstraint extends VRMNodeConstraint {
    dependencies: Set<THREE.Object3D<THREE.Event>>;
    onSetInitState?: () => void;
    onUpdate?: () => void;
    constructor(destination: THREE.Object3D, source: THREE.Object3D);
    setInitState(): void;
    update(): void;
}
