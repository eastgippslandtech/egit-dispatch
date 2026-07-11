import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

export async function pickEvidencePhoto() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { status: "denied" as const };
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.85,
  });
  return result.canceled
    ? { status: "cancelled" as const }
    : { asset: result.assets[0], status: "selected" as const };
}

export async function pickEvidenceDocument() {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  return result.canceled
    ? { status: "cancelled" as const }
    : { asset: result.assets[0], status: "selected" as const };
}
