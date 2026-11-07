
import "frida-il2cpp-bridge";

const GRAVITY = 0.1;

Il2Cpp.perform(() => {
    const image = Il2Cpp.domain.assembly("Assembly-CSharp").image;
    const klass = image.class("NinjaMovementScript");

    function hookGravity(methodName: string) {
        const method = klass.method(methodName);

        Interceptor.attach(method.virtualAddress, {
            onEnter(args) {
                (this as InvocationContext & { instance: NativePointer }).instance = args[0];
            },
            onLeave() {
                try {
                    const context = this as InvocationContext & { instance: NativePointer };
                    const instance = new Il2Cpp.Object(context.instance);
                    instance.field<number>("gravityScalef").value = GRAVITY;
                } catch (e) {
                    console.log("[AIZ3N] " + e);
                }
            }
        });

        console.log("[AIZ3N] Hooked " + methodName);
    }

    hookGravity("Awake");
    hookGravity("Start");
    hookGravity("FixedUpdate");

    console.log("[AIZ3N] Gravity patch initialized: " + GRAVITY);
});
