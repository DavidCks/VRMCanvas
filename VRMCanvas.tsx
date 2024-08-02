import { VRM, VRMExpression, VRMLoaderPlugin } from "@pixiv/three-vrm";
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, invalidate, useFrame } from "@react-three/fiber";
// import assert from "assert";
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
} from "text2expression/lib";
import { loadMixamoAnimation } from "./utils/loadMixamoAnimation.js";
import { DCKSDebug } from "dcks-debug";

export type SupportedSpeechMimingLanguage = "ipa" | "en";

export type Expressions = "angry" | "happy" | "neutral" | "relaxed" | "sad";
export type ExpressFunctionType = (
  expressions: Map<Expressions, number>
) => void;

export enum LookAtPositions {
  POINTER = 0,
  CAMERA = 1,
}

export type SpeakFunctionType = (
  word: string,
  lang?: SupportedSpeechMimingLanguage,
  speed?: number
) => Promise<void>;
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
  onModelLoaded?: (
    speak: SpeakFunctionType,
    express: ExpressFunctionType
  ) => void;
  onAllLoaded?: (vrm: VRM) => void;
  onLoadProgress?: (progress: number) => void;
}

interface ModelPropsInternal extends ModelProps {
  positions: readonly [number, number, number];
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

/**
 * Model
 *
 * @param props The Path to the VRM model to render
 */
const Model: FC<ModelPropsInternal> = (props: ModelPropsInternal) => {
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
    lang: SupportedSpeechMimingLanguage = "en",
    speed: number = 1
  ) => {
    if (speed === undefined || speed == 0 || speed === null) {
      speed = 1;
    }
    const promise: Promise<void> = new Promise((resolve, reject) => {
      if (lang == "en") {
        text2expression(
          word,
          lang,
          (props.ipaDictPaths as Map<string, string>).get("en2ipa")
        )
          .then((expressions: IPATextExpressions) => {
            const adjustedExpressions = {
              text: expressions.text,
              duration: expressions.duration * speed,
              all: expressions.all.map((exp) => {
                return {
                  ...exp,
                  duration: exp.duration * speed,
                };
              }),
            };
            console.log(`Model: mouthing '${adjustedExpressions.text}'`);
            console.log(`Model: over '${adjustedExpressions.duration}ms'`);
            setTimeout(() => {
              resolve(); // Resolve the promise after the duration
            }, adjustedExpressions.duration);
            startSpeechExpressions(adjustedExpressions);
          })
          .catch((error) => {
            reject(error); // Reject the promise if there is an error
          });
      } else {
        text2expression(word, lang)
          .then((expressions: IPATextExpressions) => {
            const adjustedExpressions = {
              text: expressions.text,
              duration: expressions.duration * speed,
              all: expressions.all.map((exp) => {
                return {
                  ...exp,
                  duration: exp.duration * speed,
                };
              }),
            };
            console.log(`Model: mouthing '${adjustedExpressions.text}'`);
            console.log(`Model: over '${adjustedExpressions.duration}ms'`);
            startSpeechExpressions(adjustedExpressions);
            setTimeout(() => {
              resolve(); // Resolve the promise after the duration
            }, adjustedExpressions.duration);
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
      // const modelResponse = await fetch(modelPath);
      // // create blob from response
      // const modelBlob = await modelResponse.blob();
      // // create objectURL from blob
      // const modelObjectURL = URL.createObjectURL(modelBlob);
      loader.load(
        modelPath,
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
        if (props.onAllLoaded && gltf && gltf.userData && gltf.userData.vrm) {
          const vrm = gltf.userData.vrm as VRM;
          props.onAllLoaded(vrm);
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
      // assert(
      //   mixer,
      //   "Error: The variable 'mixer' must be defined in the scope of this function if no new mixer is given as an argument"
      // );
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
      if (props.lookAt === LookAtPositions.POINTER) {
        const pointerPosition = state.pointer;
        vrm.lookAt.lookAt(
          new THREE.Vector3(
            pointerPosition[0],
            pointerPosition[1],
            props.positions[2]
          )
        );
      } else {
        vrm.lookAt.lookAt(
          new THREE.Vector3(
            props.positions[0],
            props.positions[1],
            props.positions[2]
          )
        );
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
  const [canvasHeight, setCanvasHeight] = useState<number>(0);
  const [canvasLeftOffset, setCanvasLeftOffset] = useState<number | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [vrm, setVrm] = useState<VRM>();
  const windowSize = useWindowSize();
  const [expressionValueMap, setExpressionValueMap] = useState<
    Map<string, number>
  >(new Map());
  const [isDraggingWindow, setIsDraggingWindow] = useState(false);
  const [expressionWindowPosition, setExpressionWindowPosition] = useState<
    [number, number]
  >([0, 0]);
  const modelProgress = useRef(0);

  useEffect(() => {
    if (gltfCanvasParentRef.current?.offsetWidth) {
      const sizeDiff =
        window.innerWidth - gltfCanvasParentRef.current.offsetWidth;
      if (sizeDiff < 0) {
        const leftOffset = sizeDiff / (Math.sqrt(Math.abs(sizeDiff)) / 2);
        setCanvasLeftOffset(leftOffset);
      }
      setCanvasHeight(gltfCanvasParentRef.current.offsetWidth);
    }
  }, [windowSize]);

  useEffect(() => {
    if (!modelProps?.showControls) {
      setExpressionWindowPosition([0, 0]);
    }
  }, [modelProps?.showControls]);

  useEffect(() => {
    if (modelProps.showControls) {
      // every 100ms, update the expressionValueMap
      const interval = setInterval(() => {
        if (vrm && vrm.expressionManager) {
          const newExpMap: Map<string, number> = new Map();
          Object.entries(vrm.expressionManager.expressionMap).map(
            /* eslint-disable-next-line */
            ([key]) => {
              const expValue = expressionValueMap.get(key);
              newExpMap.set(key, expValue);
            }
          );
          setExpressionValueMap(new Map(newExpMap));
        }
      }, 45);
      return () => clearInterval(interval);
    }
    return () => {};
  }, [vrm, modelProps.showControls]);

  const handleHover = (tf: boolean) => {
    setIsHovered(tf);
  };

  const handleWindowDrag = (e: React.MouseEvent) => {
    setExpressionWindowPosition((pos) => {
      const newPos = [pos[0] + e.movementX, pos[1] + e.movementY];
      return newPos as [number, number];
    });
  };

  return (
    <div
      ref={gltfCanvasParentRef}
      style={{
        height: `${canvasHeight}px`,
        position: "relative",
        left: canvasLeftOffset != null && `${canvasLeftOffset}px`,
      }}
    >
      <div
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          resize: "both",
          left: `${expressionWindowPosition[0]}px`,
          top: `${expressionWindowPosition[1]}px`,
          maxHeight: "100%",
          overflowY: "scroll",
          display: modelProps.showControls ? "initial" : "none",
          opacity: isHovered ? "1" : "0.1",
          backgroundColor: "rgba(0,0,0,0.5)",
        }}
        onMouseEnter={() => handleHover(true)}
        onMouseLeave={() => handleHover(false)}
      >
        {/* drag handle */}
        <div
          style={{
            width: "100%",
            height: "30px",
            backgroundColor: "rgba(0,0,0,0.5)",
            cursor: "grab",
            transition: "transform 0.1s",
            transform: isDraggingWindow ? "scale(2)" : "scale(1)",
          }}
          onMouseDown={() => {
            setIsDraggingWindow(true);
          }}
          onMouseUp={() => {
            setIsDraggingWindow(false);
          }}
          onMouseLeave={() => {
            setIsDraggingWindow(false);
          }}
          onMouseMove={(e) => {
            if (isDraggingWindow) {
              handleWindowDrag(e);
            }
          }}
        >
          {/* two horizontal lines svg */}
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line
              x1="0"
              y1="50"
              x2="100"
              y2="50"
              stroke="white"
              strokeWidth="2"
            />
          </svg>
        </div>
        {vrm?.expressionManager?.presetExpressionMap &&
          buildExpressionMap(
            Object.entries(vrm?.expressionManager?.presetExpressionMap),
            "Preset Expressions"
          )}
        {vrm?.expressionManager?.customExpressionMap &&
          buildExpressionMap(
            Object.entries(vrm?.expressionManager?.customExpressionMap),
            "Custom Expressions"
          )}
      </div>
      <Canvas
        style={{
          zIndex: modelProps.showControls ? -1 : 0,
          opacity: modelProgress.current > 99 ? "1" : "0",
          transition: "opacity 0.3s ease-in",
        }}
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
        <ambientLight
          position={[0.1, 0.5, 0.5]}
          intensity={0.7}
          color={new THREE.Color(0xffffff)}
        />
        <pointLight
          position={[
            0.2,
            canvasProps?.positions ? canvasProps?.positions[1] * 0.8 : 0.8,
            canvasProps?.positions ? canvasProps?.positions[2] * 0.7 : -0.7,
          ]}
          intensity={0.4}
          color={new THREE.Color(0xffffff)}
        />
        <pointLight
          position={[
            0.2,
            canvasProps?.positions ? canvasProps?.positions[1] * -0.8 : -0.8,
            canvasProps?.positions ? canvasProps?.positions[2] * -0.7 : 0.7,
          ]}
          intensity={0.4}
          color={new THREE.Color(0xffffff)}
        />
        <pointLight
          position={[
            0.0,
            canvasProps?.positions ? canvasProps?.positions[1] * 0.3 : 0.3,
            canvasProps?.positions ? canvasProps?.positions[2] * 0.7 : -0.7,
          ]}
          intensity={0.3}
          color={new THREE.Color(0xffffff)}
        />
        <directionalLight
          intensity={1}
          position={[
            0.1,
            canvasProps?.positions ? canvasProps?.positions[1] * 0.8 : 0.9,
            canvasProps?.positions ? canvasProps?.positions[2] * 0.7 : -0.6,
          ]}
          color={new THREE.Color(0xffffff)}
        />
        <directionalLight
          intensity={1}
          position={[
            0.1,
            canvasProps?.positions ? canvasProps?.positions[1] : 0.9,
            -0.6,
          ]}
          color={new THREE.Color(0xffffff)}
        />
        <Suspense fallback={null}>
          <Model
            ipaDictPaths={modelProps.ipaDictPaths}
            lookAt={modelProps.lookAt}
            positions={canvasProps?.positions ?? [0.1, 0.5, 0.5]}
            modelPath={modelProps.modelPath}
            idleAnimationPath={modelProps.idleAnimationPath}
            onAnimationLoaded={
              modelProps?.onAnimationLoaded ?? ((animFn) => animFn(true))
            }
            onModelLoaded={
              modelProps?.onModelLoaded ??
              ((speakFn) => speakFn("Hello World!", "ipa"))
            }
            onAllLoaded={(vrm) => {
              setVrm(vrm);
              if (modelProps?.onAllLoaded) {
                modelProps.onAllLoaded(vrm);
              }
            }}
            onLoadProgress={(progress) => {
              modelProgress.current = progress;
              if (modelProps?.onLoadProgress)
                modelProps.onLoadProgress(progress);
            }}
          />
        </Suspense>
        <OrbitControls
          target={[
            0,
            ((canvasProps ?? { positions: [0, 1, 0] }).positions ?? [
              0, 1, 0,
            ])[1] - (canvasProps?.viewAngle ?? 0.3),
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
      {/* progress */}
      <div
        style={{
          position: "absolute",
          margin: "auto",
          left: "0",
          right: "0",
          top: "0",
          bottom: "0",
          width: "fit-content",
          height: "fit-content",
          opacity: modelProgress.current < 99 ? "0.5" : "0",
          boxShadow: "0px 0px 80px black",
          backgroundColor: "rgba(0,0,0,0.5)",
          borderRadius: "40px",
          transition: "opacity 0.3s ease-out",
          pointerEvents: "none",
        }}
      >
        {/* svg spiler */}
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* loading... text */}
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="white"
            fontSize="0.8rem"
          >
            Loading
          </text>
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="white"
            strokeWidth="2"
            stroke-dasharray="8"
            fill="none"
          />
        </svg>
      </div>
    </div>
  );

  function buildExpressionMap(
    expressions: [string, VRMExpression][],
    title: string
  ): React.ReactNode {
    return (
      <div>
        <p
          style={{
            color: "white",
            margin: "0",
            padding: "0",
            textAlign: "center",
            fontSize: "1.5em",
          }}
        >
          {title}
        </p>
        <ul>
          {expressions.map((exp) => (
            <li style={{ display: "flex", flexDirection: "row" }} key={exp[0]}>
              <div>{exp[0]}</div>
              <div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={vrm.expressionManager.getValue(exp[0])}
                  onChange={(e) => {
                    setExpressionValueMap(
                      new Map(
                        expressionValueMap.set(
                          exp[0],
                          parseFloat(e.target.value)
                        )
                      )
                    );
                    vrm.expressionManager.setValue(
                      exp[0],
                      parseFloat(e.target.value)
                    );
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }
};
