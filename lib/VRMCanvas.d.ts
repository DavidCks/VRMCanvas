import { FC } from "react";
export type SupportedSpeechMimingLanguage = "ipa" | "en";
export type Expressions = "angry" | "happy" | "neutral" | "relaxed" | "sad";
export type ExpressFunctionType = (expressions: Map<Expressions, number>) => void;
export type SpeakFunctionType = (word: string, lang?: SupportedSpeechMimingLanguage) => void;
/**
 * Model props
 *
 * @param modelPath The Path to the VRM model to render
 */
export interface ModelProps {
    modelPath: string;
    idleAnimationPath: string;
    ipaDictPaths?: Map<string, string>;
    onAnimationLoaded?: (animate: (tf: boolean) => void) => void;
    onModelLoaded?: (speak: SpeakFunctionType, express: ExpressFunctionType) => void;
    onLoadProgress?: (progress: number) => void;
}
export interface VRMCanvasProps {
    backgroundColor?: [number, number, number];
    positions?: readonly [number, number, number];
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
