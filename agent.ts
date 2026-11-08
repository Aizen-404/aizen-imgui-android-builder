import "frida-il2cpp-bridge";

const START_DELAY = 15000;
const SCAN_INTERVAL = 3000;
const MAX_ITEMS = 4096;

let busy = false;

function readPtr(base: NativePointer, offset: number): NativePointer {
    return base.add(offset).readPointer();
}

function readInt(base: NativePointer, offset: number): number {
    return base.add(offset).readS32();
}

function readString(address: NativePointer): string {
    if (address.isNull()) return "";
    const length = address.add(0x10).readS32();
    if (length < 0 || length > 4096) return "";
    return address.add(0x14).readUtf16String(length) || "";
}

function il2cppString(value: string): Il2Cpp.Object {
    return Il2Cpp.string(value) as unknown as Il2Cpp.Object;
}

function getDictionaryPairs(dictionary: NativePointer): Map<string, string> {
    const result = new Map<string, string>();
    if (dictionary.isNull()) return result;

    const entries = readPtr(dictionary, 0x18);
    if (entries.isNull()) return result;

    const capacity = readInt(entries, 0x18);
    if (capacity <= 0 || capacity > MAX_ITEMS) return result;

    for (let i = 0; i < capacity; i++) {
        const entry = entries.add(0x20 + i * 0x18);
        if (entry.readS32() < 0) continue;

        const key = readString(readPtr(entry, 0x08));
        const value = readString(readPtr(entry, 0x10));

        if (key) result.set(key, value);
    }

    return result;
}

function setDictionaryValue(
    dictionary: NativePointer,
    key: string,
    value: string
): void {
    const object = new Il2Cpp.Object(dictionary);
    object.method("set_Item", 2).invoke(
        il2cppString(key),
        il2cppString(value)
    );
}

function patchFullSF(aedda: NativePointer, lcjkIndex: number, gchIndex: number): boolean {
    try {
        const dictionary = readPtr(aedda, 0x10);
        if (dictionary.isNull()) return false;

        const object = new Il2Cpp.Object(dictionary);
        object.method("Remove", 1).invoke(il2cppString("Tag"));

        setDictionaryValue(dictionary, "Name", "rule_Perputal_SF");
        setDictionaryValue(dictionary, "ApplyTo", "Player");

        aedda.add(0x20).writeS32(1);

        const fullSF = il2cppString("FullSF");
        aedda.add(0x28).writePointer(fullSF.handle);

        console.log(
            "[FullSF] LCJK=" + lcjkIndex +
            " GCH=" + gchIndex +
            " AEDDA[0] PATCHED"
        );
        return true;
    } catch (e) {
        console.log("[FullSF ERROR] " + e);
        return false;
    }
}

function modifyPlayerApplyFactor(
    dictionary: NativePointer,
    lcjkIndex: number,
    gchIndex: number,
    index: number
): void {
    const pairs = getDictionaryPairs(dictionary);

    const shadowKey = pairs.has("ShadowDamage")
        ? "ShadowDamage"
        : pairs.has("MagicPower")
            ? "MagicPower"
            : "";

    if (!shadowKey) {
        console.log("[ApplyFactor] ShadowDamage/MagicPower missing; skipped");
        return;
    }

    const oldShadow = Number(pairs.get(shadowKey));
    const oldWeapon = Number(pairs.get("WeaponDamage"));

    if (
        !Number.isFinite(oldShadow) ||
        oldShadow <= 0 ||
        !Number.isFinite(oldWeapon)
    ) {
        console.log("[ApplyFactor] Invalid damage values; skipped");
        return;
    }

    const newShadow = 7.5;
    const ratio = newShadow / oldShadow;
    const newWeapon = oldWeapon * ratio;

    setDictionaryValue(dictionary, "BodyDefense", "300");
    setDictionaryValue(dictionary, "HeadDefense", "300");
    setDictionaryValue(dictionary, shadowKey, String(newShadow));
    setDictionaryValue(dictionary, "WeaponDamage", String(newWeapon));

    console.log(
        "[ApplyFactor MODIFIED] LCJK=" + lcjkIndex +
        " GCH=" + gchIndex +
        " AEDDA=" + index +
        " " + shadowKey + "=" + oldShadow + " -> " + newShadow +
        " WeaponDamage=" + oldWeapon + " -> " + newWeapon +
        " Ratio=" + ratio.toFixed(4) +
        " BodyDefense=300 HeadDefense=300"
    );
}

function modifyCollectionRule(
    dictionary: NativePointer,
    pairs: Map<string, string>,
    lcjkIndex: number,
    gchIndex: number,
    index: number,
    operation: string
): void {
    let changed = 0;

    for (const [key, value] of pairs) {
        if (!/collection|level|id/i.test(key)) continue;

        const number = Number(value);
        if (!Number.isFinite(number) || number !== 6) continue;

        setDictionaryValue(dictionary, key, "4");
        changed++;

        console.log(
            "[COLLECTION MODIFIED] LCJK=" + lcjkIndex +
            " GCH=" + gchIndex +
            " AEDDA=" + index +
            " Operation=" + operation +
            " Key=" + key +
            " Value=6 -> 4"
        );
    }

    if (changed === 0) {
        console.log(
            "[COLLECTION] LCJK=" + lcjkIndex +
            " GCH=" + gchIndex +
            " AEDDA=" + index +
            " No matching numeric field with value 6"
        );
    }
}

function processAEDDAList(
    aeddaList: NativePointer,
    lcjkIndex: number,
    gchIndex: number
): void {
    if (aeddaList.isNull()) return;

    const items = readPtr(aeddaList, 0x10);
    const count = readInt(aeddaList, 0x18);

    if (items.isNull() || count <= 0 || count > MAX_ITEMS) return;

    console.log(
        "\n[LCJK " + lcjkIndex +
        " GCH " + gchIndex +
        "] AEDDA COUNT: " + count
    );

    for (let i = 0; i < count; i++) {
        try {
            const aedda = readPtr(items, 0x20 + i * 0x08);
            if (aedda.isNull()) continue;

            const dictionary = readPtr(aedda, 0x10);
            if (dictionary.isNull()) continue;

            const operation = readString(readPtr(aedda, 0x28));
            const pairs = getDictionaryPairs(dictionary);
            const applyTo = pairs.get("ApplyTo") || "";
            const before = readInt(dictionary, 0x20);

            if (i === 0) {
                patchFullSF(aedda, lcjkIndex, gchIndex);
                continue;
            }

            if (operation === "MultiLayerHP" && applyTo === "Enemy") {
                console.log(
                    "[KEEP] MultiLayerHP | Enemy | Count=" + before
                );
                continue;
            }

            if (operation === "ApplyFactor" && applyTo === "Player") {
                modifyPlayerApplyFactor(
                    dictionary,
                    lcjkIndex,
                    gchIndex,
                    i
                );

                console.log(
                    "[KEEP] ApplyFactor | Player | Count=" +
                    readInt(dictionary, 0x20)
                );
                continue;
            }

            if (
                applyTo === "Enemy" &&
                operation.toLowerCase().includes("collection")
            ) {
                modifyCollectionRule(
                    dictionary,
                    pairs,
                    lcjkIndex,
                    gchIndex,
                    i,
                    operation
                );

                console.log(
                    "[KEEP] Collection | Enemy | Count=" +
                    readInt(dictionary, 0x20)
                );
                continue;
            }

            if (before > 0) {
                dictionary.add(0x20).writeS32(0);
            }

            const after = readInt(dictionary, 0x20);

            console.log(
                "[ZERO] LCJK=" + lcjkIndex +
                " GCH=" + gchIndex +
                " AEDDA=" + i +
                " Operation=" + operation +
                " ApplyTo=" + applyTo +
                " Count=" + before + " -> " + after
            );
        } catch (e) {
            console.log(
                "[AEDDA ERROR] LCJK=" + lcjkIndex +
                " GCH=" + gchIndex +
                " INDEX=" + i + " " + e
            );
        }
    }
}

function processOHFP(ohfp: NativePointer, lcjkIndex: number): void {
    if (ohfp.isNull()) return;

    const items = readPtr(ohfp, 0x10);
    const count = readInt(ohfp, 0x18);

    if (items.isNull() || count <= 0 || count > MAX_ITEMS) return;

    console.log("[LCJK " + lcjkIndex + "] GCH COUNT: " + count);

    for (let i = 0; i < count; i++) {
        try {
            const gch = readPtr(items, 0x20 + i * 0x08);
            if (gch.isNull()) continue;

            const aeddaList = readPtr(gch, 0x10);
            processAEDDAList(aeddaList, lcjkIndex, i);
        } catch (e) {
            console.log(
                "[GCH ERROR] LCJK=" + lcjkIndex +
                " INDEX=" + i + " " + e
            );
        }
    }
}

function scanAndPatch(): void {
    if (busy) return;
    busy = true;

    try {
        Il2Cpp.perform(() => {
            try {
                const assembly = Il2Cpp.domain.assembly("SF3");
                const klass = assembly.image.class("SF3.BattlesManager");
                const getter = klass.method("get_instance", 0);
                const manager = getter.invoke() as Il2Cpp.Object;

                if (manager.handle.isNull()) {
                    console.log("[WAIT] BattlesManager unavailable");
                    return;
                }

                const imki = readPtr(manager.handle, 0x48);
                if (imki.isNull()) {
                    console.log("[WAIT] IMKI unavailable");
                    return;
                }

                const phgal = readPtr(imki, 0x30);
                if (phgal.isNull()) return;

                const phgalItems = readPtr(phgal, 0x10);
                if (phgalItems.isNull()) return;

                const lcjkCount = readInt(phgalItems, 0x18);

                if (lcjkCount <= 0 || lcjkCount > MAX_ITEMS) {
                    console.log("[WAIT] Invalid PHGALItems count: " + lcjkCount);
                    return;
                }

                console.log("\n========== AIZ3N FINAL RULE PATCH ==========");
                console.log("[IMKI] FOUND");
                console.log("[PHGALItems] LCJK COUNT: " + lcjkCount);

                for (let i = 0; i < lcjkCount; i++) {
                    try {
                        const lcjk = readPtr(phgalItems, 0x20 + i * 0x08);
                        if (lcjk.isNull()) continue;

                        const ohfp = readPtr(lcjk, 0x18);
                        if (ohfp.isNull()) continue;

                        console.log("\n========== LCJK ITEM " + i + " ==========");
                        processOHFP(ohfp, i);
                    } catch (e) {
                        console.log("[LCJK ERROR] INDEX=" + i + " " + e);
                    }
                }

                console.log("\n========== SCAN COMPLETE ==========");
            } catch (e) {
                console.log("[SCAN ERROR] " + e);
            } finally {
                busy = false;
            }
        });
    } catch (e) {
        busy = false;
        console.log("[IL2CPP ERROR] " + e);
    }
}

console.log("[AIZ3N] Starting in 15 seconds...");

setTimeout(() => {
    console.log("[AIZ3N] Initial scan started");
    scanAndPatch();

    setInterval(() => {
        scanAndPatch();
    }, SCAN_INTERVAL);
}, START_DELAY);
