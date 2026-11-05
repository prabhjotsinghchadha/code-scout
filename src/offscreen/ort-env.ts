// Imported before the OCR library: points ONNX Runtime at the copy of its WebAssembly bundled with the
// extension. Otherwise the OCR library would point it at a CDN, which extension pages can't load code from.
import * as ort from 'onnxruntime-web';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
// Threads need a cross-origin isolated page; one thread is plenty for a subtitle strip.
ort.env.wasm.numThreads = 1;
