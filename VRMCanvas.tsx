import { VRM, VRMLoaderPlugin } from "@pixiv/three-vrm";
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, invalidate, useFrame } from "@react-three/fiber";
import assert from "assert";
import useWindowSize from "./hooks/useWindowSize";
import React, { FC, Suspense, useEffect, useRef, useState } from "react";
import { RootState } from "@react-three/fiber";
import * as THREE from "three";
import { GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  text2expression,
  IPATextExpressions,
  emptyVRMMouthExpression,
  VRMMouthExpression,
} from "../Text2Expression/lib";
import { loadMixamoAnimation } from "./utils/loadMixamoAnimation.js";
import { DCKSDebug } from "dcks-debug";

export type SupportedSpeechMimingLanguage = "ipa" | "en";

export type Expressions = "angry" | "happy" | "neutral" | "relaxed" | "sad";
export type ExpressFunctionType = (
  expressions: Map<Expressions, number>
) => void;

export type SpeakFunctionType = (
  word: string,
  lang?: SupportedSpeechMimingLanguage
) => Promise<void>;
/**
 * Model props
 *
 * @param modelPath The Path to the VRM model to render
 */
export interface ModelProps {
  modelPath: string;
  idleAnimationPath: string;
  ipaDictPaths?: Map<string, string>;
  autoSpeak?: boolean;
  onAnimationLoaded?: (animate: (tf: boolean) => void) => void;
  onModelLoaded?: (
    speak: SpeakFunctionType,
    express: ExpressFunctionType
  ) => void;
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

/**
 * Model
 *
 * @param props The Path to the VRM model to render
 */
const Model: FC<ModelProps> = (props: ModelProps) => {
  const [gltf, setGltf] = useState<GLTF>();
  const [modelProgress, setModelProgress] = useState<number>(0);
  const [animationProgress, setAnimationProgress] = useState<number>(0);
  const [mixer, setMixer] = useState<THREE.AnimationMixer>();
  //const [currentAnimation, setCurrentAnimation] = useState<string>("");
  const [currentAnimationAction, setCurrentAnimationAction] =
    useState<THREE.AnimationAction>();
  const [animationClips, setAnimationClips] = useState<
    Map<string, THREE.AnimationClip>
  >(new Map());
  const [emotions, setEmotions] = useState<Map<Expressions, number>>(new Map());
  // const getCurrentAnimationClip = (): THREE.AnimationClip => {
  //   return animationClips.get(currentAnimation) as THREE.AnimationClip;
  // };

  const [animationState, setAnimationState] = useState(false);

  const animate = (tf: boolean) => {
    setAnimationState(tf);
    setTimeout(() => {
      invalidate();
    }, 30);
  };

  const speechExpressions = useRef([emptyVRMMouthExpression(-1)]);
  const speechExpressionIndex = useRef(-1);
  const speechDuration = useRef(0);

  const express: ExpressFunctionType = (
    expressions: Map<Expressions, number>
  ) => {
    setEmotions(expressions);
  };

  const speak: SpeakFunctionType = async (
    word: string,
    lang: SupportedSpeechMimingLanguage = "en"
  ) => {
    const promise: Promise<void> = new Promise((resolve, reject) => {
      if (lang == "en") {
        text2expression(
          word,
          lang,
          (props.ipaDictPaths as Map<string, string>).get("en2ipa")
        )
          .then((expressions: IPATextExpressions) => {
            console.log(`Model: mouthing '${expressions.text}'`);
            console.log(`Model: over '${expressions.duration}ms'`);
            setTimeout(() => {
              resolve(); // Resolve the promise after the duration
            }, expressions.duration);
            startSpeechExpressions(expressions);
          })
          .catch((error) => {
            reject(error); // Reject the promise if there is an error
          });
      } else {
        text2expression(word, lang)
          .then((expressions: IPATextExpressions) => {
            console.log(`Model: mouthing '${expressions.text}'`);
            console.log(`Model: over '${expressions.duration}ms'`);
            startSpeechExpressions(expressions);
            resolve(); // Resolve the promise immediately after starting expressions
          })
          .catch((error) => {
            reject(error); // Reject the promise if there is an error
          });
      }
    });
    return promise;
  };

  function startSpeechExpressions(exps: IPATextExpressions) {
    speechStartedTimestamp.current = 0;
    setIsSilent(false);
    speechDuration.current = exps.duration;
    speechExpressions.current = exps.all;
    speechExpressionIndex.current = 0;
  }

  let loadingStarted = useRef(false);
  useEffect(() => {
    if (!gltf && !loadingStarted.current) {
      loadingStarted.current = true;
      loadVRM(props.modelPath);
    } else if (animationProgress > 99.9 && modelProgress > 99.9) {
      onLoaded();
      if (props.onLoadProgress) {
        props.onLoadProgress(100);
      }
    }
  });

  const setProgress = (
    progressSetter: (x: number) => void,

    progressEvent: ProgressEvent<EventTarget>,
    progressSource: string
  ) => {
    progressSetter((progressEvent.loaded / progressEvent.total) * 100);
    if (props.onLoadProgress) {
      props.onLoadProgress((progressEvent.loaded / progressEvent.total) * 100);
    }
    console.log(
      progressSource +
        ": " +
        (progressEvent.loaded / progressEvent.total) * 100 +
        "% loaded"
    );
  };

  const loadVRM = async (modelPath: string) => {
    if (!gltf) {
      const loader = new GLTFLoader();
      loader.register((parser) => {
        return new VRMLoaderPlugin(parser);
      });
      const modelResponse = await fetch(modelPath);
      // create blob from response
      const modelBlob = await modelResponse.blob();
      // create objectURL from blob
      const modelObjectURL = URL.createObjectURL(modelBlob);
      loader.load(
        modelObjectURL,
        (tmpGltf) => {
          setGltf(tmpGltf);
          loadFBX(props.idleAnimationPath, tmpGltf.userData.vrm);
          console.log(`Loader: loaded ${modelPath}`);
          console.log(`Loader: available expressions:`);
          console.log(
            tmpGltf.userData.vrm.expressionManager?.presetExpressionMap ??
              "No expressions found."
          );
          console.log(`Expression Manager:`);
          console.log(tmpGltf.userData.vrm.expressionManager);
          console.log(`VRM Model:`);
          console.log(tmpGltf.userData.vrm);
        },
        // called as loading progresses
        (xhr) => {
          setProgress(setModelProgress, xhr, "Model");
        },
        // called when loading has errors
        (error) => {
          console.log("An error happened");
          console.log(error);
        }
      );
    }
  };

  const [loaded, setLoaded] = useState(false);
  function onLoaded() {
    if (!loaded) {
      setLoaded(true);
      setTimeout(() => {
        if (props.onAnimationLoaded) {
          props.onAnimationLoaded(animate);
        }
        if (props.onModelLoaded) {
          props.onModelLoaded(speak, express);
        }
      }, 30);
    }
  }

  const crossFade = (
    from: THREE.AnimationAction,
    to: THREE.AnimationAction
  ): THREE.AnimationAction => {
    if (!from) {
      return to;
    }
    to.weight = 10;
    return from.crossFadeTo(to, 5, false);
  };

  const setAnimation = (
    animationClip: THREE.AnimationClip,
    animationMixer?: THREE.AnimationMixer
  ) => {
    if (animationMixer) {
      const nextAnimationAction = animationMixer.clipAction(animationClip);
      const action = crossFade(
        currentAnimationAction as THREE.AnimationAction,
        nextAnimationAction
      );
      action.play();
      animationMixer.timeScale = 1;
      setMixer(animationMixer);
      setCurrentAnimationAction(action);
    } else {
      assert(
        mixer,
        "Error: The variable 'mixer' must be defined in the scope of this function if no new mixer is given as an argument"
      );
      const nextAnimationAction = mixer.clipAction(animationClip);
      const action = crossFade(
        currentAnimationAction as THREE.AnimationAction,
        nextAnimationAction
      );
      setTimeout(
        () => (currentAnimationAction as THREE.AnimationAction).stop(),
        1000
      );
      action.play();
      mixer.timeScale = 1;
      setCurrentAnimationAction(action);
    }
  };

  const updateAnimationClips = (key: string, value: THREE.AnimationClip) => {
    animationClips.set(key, value);
    setAnimationClips(animationClips);
  };

  const loadFBX = (animationPath: string, vrm: any = undefined) => {
    //setCurrentAnimation(animationPath);
    if (mixer && gltf) {
      const newMixer = new THREE.AnimationMixer(gltf.userData.vrm.scene);
      if (animationClips.has(animationPath)) {
        setAnimation(
          animationClips.get(animationPath) as THREE.AnimationClip,
          newMixer
        );
        onLoaded();
        return;
      }
      loadMixamoAnimation(animationPath, gltf.userData.vrm, (xhr: any) =>
        setProgress(setAnimationProgress, xhr, "Animation")
      ).then((clip) => {
        setAnimation(clip, newMixer);
        updateAnimationClips(animationPath, clip);
        onLoaded();
      });
    } else if (vrm) {
      const newMixer = new THREE.AnimationMixer(vrm.scene);
      if (animationClips.has(animationPath)) {
        setAnimation(
          animationClips.get(animationPath) as THREE.AnimationClip,
          newMixer
        );
        onLoaded();
        return;
      }
      loadMixamoAnimation(animationPath, vrm, (xhr: any) =>
        setProgress(setAnimationProgress, xhr, "Animation")
      ).then((clip) => {
        setAnimation(clip, newMixer);
        updateAnimationClips(animationPath, clip);
        onLoaded();
      });
    } else if (gltf) {
      const newMixer = new THREE.AnimationMixer(gltf.userData.vrm.scene);
      if (animationClips.has(animationPath)) {
        setAnimation(
          animationClips.get(animationPath) as THREE.AnimationClip,
          newMixer
        );
        onLoaded();
        return;
      }
      loadMixamoAnimation(animationPath, gltf.userData.vrm, (xhr: any) =>
        setProgress(setAnimationProgress, xhr, "Animation")
      ).then((clip) => {
        setAnimation(clip, newMixer);
        updateAnimationClips(animationPath, clip);
        onLoaded();
      });
    } else {
      console.log(
        "Error: Something went wrong while executing loadFBX. A mixer with the correct vrm needs to be part of the scope or a vrm must be passed to this function."
      );
    }
  };

  const offsets = new Map(
    Object.entries({
      aa: 0,
      happy: -0.5,
    })
  );
  const syncedExpressions = ["aa"];
  const updateSyncedExpressions = (vrm: VRM, value: number) => {
    syncedExpressions.forEach((exp) => {
      vrm.expressionManager!.setValue(
        exp,
        (value + offsets.get(exp)!) as number
      );
    });
  };

  let speechExpressionStartedTimestamp = 0;
  useFrame((state: RootState, delta: number) => {
    if (!!mixer && !!gltf) {
      const vrm = gltf.userData.vrm as VRM;
      const aa = vrm.expressionManager?.getValue("aa");
      const ee = vrm.expressionManager?.getValue("ee");
      const ih = vrm.expressionManager?.getValue("ih");
      const oh = vrm.expressionManager?.getValue("oh");
      const ou = vrm.expressionManager?.getValue("ou");
      emotions.forEach((value, expressionName) => {
        const prevValue = vrm.expressionManager?.getValue(expressionName);
        vrm.expressionManager?.setValue(
          expressionName,
          (value + prevValue) / 2
        );
      });

      if (speechExpressionIndex.current != -1) {
        expressSpeech(state);
      }
      if (props.autoSpeak && speechSynthesis && speechSynthesis.speaking) {
        if (speechExpressionIndex.current == -1) {
          oscilateMouth(state, aa ?? 0.01);
        }
      } else {
        crossFadeReset({
          aa: aa ?? 0.01,
          ee: ee ?? 0.01,
          ih: ih ?? 0.01,
          oh: oh ?? 0.01,
          ou: ou ?? 0.01,
        });
      }

      if (animationState) {
        invalidate();
        mixer.update(delta);
        vrm.update(delta);
      }
    }
  });

  function crossFadeReset(kvargs: {
    aa: number;
    ee: number;
    ih: number;
    oh: number;
    ou: number;
  }) {
    const vrm = gltf!.userData.vrm as VRM;
    Object.entries(kvargs).forEach((exp) => {
      if (exp[1] > 0.1) {
        vrm.expressionManager!.setValue(exp[0], exp[1] / 1.2);
      }
    });
  }

  function TweenMouthExpression(to: VRMMouthExpression) {
    const vrm = gltf!.userData.vrm as VRM;
    Object.entries(to).forEach((exp) => {
      if (exp[0] !== "duration") {
        const expVal = vrm.expressionManager!.getValue(exp[0]);
        const tweenedVal = (expVal! + (exp[1] as number)) / 2;
        vrm.expressionManager!.setValue(exp[0], tweenedVal);
        DCKSDebug("EXP", new Map([[exp[0], `${tweenedVal}`]]));
      }
    });
  }

  let speechStartedTimestamp = useRef(0);
  const [isSilent, setIsSilent] = useState(false);
  function expressSpeech(state: RootState) {
    // set up the timing for the full speech motion
    if (speechStartedTimestamp.current === 0) {
      //if the speaking has just been started
      speechStartedTimestamp.current = state.clock.elapsedTime * 1000;
      DCKSDebug(
        "EXP",
        new Map([["start", `${speechStartedTimestamp.current}`]])
      );
    } else if (
      state.clock.elapsedTime * 1000 - speechStartedTimestamp.current >
      speechDuration.current
    ) {
      if (isSilent) {
        return;
      }
      setIsSilent(true);
      DCKSDebug("EXP", new Map([["dur", `${speechDuration.current}ms`]]));
      //if the speaking has continued longer than predicted
      speechExpressionIndex.current = 0;
      speechStartedTimestamp.current = 0;
      speechDuration.current = 650;
      speechExpressions.current = [
        emptyVRMMouthExpression(110),
        emptyVRMMouthExpression(110),
        emptyVRMMouthExpression(110),
        emptyVRMMouthExpression(110),
        emptyVRMMouthExpression(110),
        emptyVRMMouthExpression(110),
      ];

      return;
    }
    if (speechExpressionStartedTimestamp === 0) {
      //if the expression has just started
      speechExpressionStartedTimestamp = state.clock.elapsedTime * 1000;
    }
    const speechExpression: VRMMouthExpression =
      speechExpressions.current.length > 0
        ? speechExpressions.current[speechExpressionIndex.current]
        : {
            duration: speechDuration.current,
            aa: 0,
            ee: 0,
            ih: 0,
            oh: 0,
            ou: 0,
          };
    speechExpression && TweenMouthExpression(speechExpression);

    if (
      state.clock.elapsedTime * 1000 - speechExpressionStartedTimestamp >=
      speechExpression.duration
    ) {
      //if the expression has been going on for longer than the predicted duration
      const timeDiff =
        state.clock.elapsedTime * 1000 -
        speechExpressionStartedTimestamp -
        speechExpression.duration;
      speechExpressionStartedTimestamp = 0;
      const nextIndexValue = speechExpressionIndex.current + 1;
      let nextIndex =
        nextIndexValue >= speechExpressions.current.length
          ? -1
          : nextIndexValue;
      if (nextIndex != -1) {
        const nextExpression = speechExpressions.current[nextIndex];
        const nextExpressionDuration = nextExpression.duration;
        if (nextExpressionDuration - timeDiff > 0) {
          // recalculate the duration difference of the next expression by
          // taking the time difference it took to determine that the next
          // expression should be started into account
          speechExpressions.current[nextIndex].duration =
            nextExpressionDuration - timeDiff;
        } else {
          // skip one expression should the time difference neccesitate it
          // and recalculate the time difference for the expression after
          // the skipped one
          const nextNextIndex =
            nextIndex + 1 >= speechExpressions.current.length
              ? -1
              : nextIndex + 1;
          if (nextNextIndex != -1) {
            const nextNextExpression = speechExpressions.current[nextNextIndex];
            speechExpressions.current[nextNextIndex].duration =
              nextNextExpression.duration - timeDiff;
            nextIndex = nextNextIndex;
          } else {
          }
        }
      }
      if (nextIndex === -1) {
        setIsSilent(false);
        speechStartedTimestamp.current = 0;
      }
      speechExpressionIndex.current = nextIndex;
    }
  }

  function oscilateMouth(state: RootState, mouthVal: number) {
    const talkingSpeed = 1; // the smaller, the faster
    const minimumTalkingMouthOpennes = 0.1; // 0 - closed, 1 - fully opened
    const maximumTalkingMouthOpennes = 0.15; // 0 - fully opened, 1 - half closed
    const time = state.clock.getElapsedTime();
    const s = Math.sin((Math.PI * time) / talkingSpeed);
    const osc =
      (0.5 + 0.5 * s + minimumTalkingMouthOpennes) /
      (1 + minimumTalkingMouthOpennes + maximumTalkingMouthOpennes);
    const vrm = gltf!.userData.vrm as VRM;
    if (Math.abs(mouthVal - osc) < 0.1) {
      updateSyncedExpressions(vrm, osc);
    } else {
      updateSyncedExpressions(vrm, (mouthVal + 0.01) * 1.2);
    }
  }

  return (
    <>
      {gltf && mixer ? (
        <mesh
        // onClick={() => switchTroughAnimations()}
        >
          <primitive object={gltf.scene} />
        </mesh>
      ) : (
        <Html>
          Model {modelProgress} % loaded
          <br />
          Animation {animationProgress} % loaded
        </Html>
      )}
    </>
  );
};

export const VRMCanvas: FC<CanvasProps> = ({ modelProps, canvasProps }) => {
  const gltfCanvasParentRef = useRef<HTMLDivElement>(null);
  const [canvasWidthAndHeight, setCanvasWidthAndHeight] = useState<number>(0);
  const windowSize = useWindowSize();

  useEffect(() => {
    if (gltfCanvasParentRef.current?.offsetWidth) {
      setCanvasWidthAndHeight(gltfCanvasParentRef.current.offsetWidth);
    }
  }, [windowSize]);

  return (
    <div
      ref={gltfCanvasParentRef}
      style={{ height: `${canvasWidthAndHeight}px` }}
    >
      <Canvas
        gl={{ alpha: canvasProps?.backgroundColor ? false : true }}
        frameloop="demand"
        camera={{
          fov: 20,
          near: 0.1,
          far: 300,
          position: canvasProps?.positions ?? [0, 0.4, -2],
        }}
        flat
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[1, 1, -1]} color={new THREE.Color()} />
        <Suspense fallback={null}>
          <Model
            ipaDictPaths={modelProps.ipaDictPaths}
            modelPath={modelProps.modelPath}
            idleAnimationPath={modelProps.idleAnimationPath}
            onAnimationLoaded={
              modelProps?.onAnimationLoaded ?? ((animFn) => animFn(true))
            }
            onModelLoaded={
              modelProps?.onModelLoaded ??
              ((speakFn) => speakFn("Hello World!", "ipa"))
            }
            onLoadProgress={modelProps.onLoadProgress}
          />
        </Suspense>
        <OrbitControls
          target={[
            0,
            ((canvasProps ?? { positions: [0, 1, 0] }).positions ?? [
              0, 1, 0,
            ])[1] - 0.3,
            0,
          ]}
          enableZoom={true}
          enablePan={true}
          enableDamping={true}
        />
        {canvasProps?.backgroundColor && (
          <color
            attach="background"
            args={canvasProps?.backgroundColor ?? [255, 255, 255]}
          />
        )}
        {/* <gridHelper /> */}
      </Canvas>
    </div>
  );
};
