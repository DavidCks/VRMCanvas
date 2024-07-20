# vrmcanvas

## Important

When setting the state for the speak and expression function after the VRM model is loaded, you must use `setState(() => fn)`, not setState(fn), because react executes any callback function passed to setState.
