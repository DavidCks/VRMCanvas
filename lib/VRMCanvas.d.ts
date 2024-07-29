import { VRM } from "@pixiv/three-vrm";
import { FC } from "react";
export type SupportedSpeechMimingLanguage = "ipa" | "en";
export type Expressions = "angry" | "happy" | "neutral" | "relaxed" | "sad";
export type ExpressFunctionType = (expressions: Map<Expressions, number>) => void;
export declare enum LookAtPositions {
    POINTER = 0,
    CAMERA = 1
}
export type SpeakFunctionType = (word: string, lang?: SupportedSpeechMimingLanguage, speed?: number) => Promise<void>;
/**
 * Model props
 *
 * @param modelPath The Path to the VRM model to render
 */
export interface ModelProps {
    modelPath: string;
    lookAt: LookAtPositions;
    idleAnimationPath: string;
    ipaDictPaths?: Map<"en2ipa", string>;
    autoSpeak?: boolean;
    showControls?: boolean;
    onAnimationLoaded?: (animate: (tf: boolean) => void) => void;
    onModelLoaded?: (speak: SpeakFunctionType, express: ExpressFunctionType) => void;
    onAllLoaded?: (vrm: VRM) => void;
    onLoadProgress?: (progress: number) => void;
}
/**
 * Vrmcanvas props
 *
 * @param backgroundColor Tuple of [r,g,b] where each value is between 0 and 1
 * @param positions Tuple of [x,y,z] where each value is a number
 */
export interface VRMCanvasProps {
    backgroundColor?: [number, number, number];
    positions?: readonly [number, number, number];
    viewAngle?: number;
}
/**
 * Canvas props
 *
 * @param modelProps The Properties for the VRM model to render
 * @param canvasProps The Properties for the underlying Canvas
 */
export interface CanvasProps {
    modelProps: ModelProps;
    canvasProps?: VRMCanvasProps;
}
export declare const VRMCanvas: FC<CanvasProps>;
