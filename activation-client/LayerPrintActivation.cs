// Проверка активации для программы «Печать по слоям» (AutoCAD 2022, .NET Framework 4.8).
// Компилируется вместе с программой (Build.ps1 подключает его из папки activation-client проекта МДР);
// проверен на .NET Framework 4 против ключей, подписанных кодом сайта.
//
// Схема: сайт (Edge Function issue-activation) подписывает строку
//     layerprint|<код компьютера>|<email>|<дата выдачи ISO>
// приватным RSA-ключом. Ключ активации = base64url(строка) + "." + base64url(подпись).
// Здесь — только ПУБЛИЧНЫЙ ключ: им можно проверить подпись, но нельзя выдать новый ключ.
using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace PSDPRO.LayerPrint
{
    public static class LayerPrintActivation
    {
        // Значения печатает `node activation-client/generate-keys.js`
        const string PublicModulusBase64 = "tPMXyg8WZiKwSYjgynTQgYQVatBB5puv10kZ6pTFTw6TNMoI6vkgW/o2nMYn0JK9ANbUMvM9dQFDSA9gKzxatokgt3KOQWcNJBU8RCsxjDwclLeEsQ2USabYGVs+1302wGK+xWAv8WJWAE7aYowbitDxLdyaylVEKcwO6b19745IRN3aG3B+qjQpkqTqZcYB8nu8V7JjToZ84lMxDbOaMSt2684Oi77R2wQs3LcOYusxyQOhTPTkcX2Y/Z/LQ4Mfu5XQWBo9Z1tJGU288En9Mp5/VKzLQXfW1kiOK9VJO8HdJ04FgKayyrZK9/3CXeRk/viQVEqi11ShCxrcHRNfMw==";
        const string PublicExponentBase64 = "AQAB";
        const string Product = "layerprint";

        static string KeyFile
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "PSDPRO", "LayerPrint", "activation.key");
            }
        }

        /// <summary>Код компьютера вида XXXX-XXXX-XXXX-XXXX — его пользователь вставляет на сайте во вкладке «Материалы».</summary>
        public static string GetMachineId()
        {
            string guid;
            using (var baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
            using (var k = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography"))
                guid = (k == null ? null : k.GetValue("MachineGuid") as string) ?? "unknown";
            using (var sha = SHA256.Create())
            {
                var h = sha.ComputeHash(Encoding.UTF8.GetBytes("PSDPRO-LayerPrint|" + guid.ToLowerInvariant()));
                var hex = string.Concat(h.Take(8).Select(b => b.ToString("X2")));
                return string.Join("-", Enumerable.Range(0, 4).Select(i => hex.Substring(i * 4, 4)));
            }
        }

        /// <summary>Проверяет ключ. При успехе возвращает email владельца.</summary>
        public static bool Verify(string activationKey, out string email, out string error)
        {
            email = null; error = null;
            try
            {
                var parts = (activationKey ?? "").Trim().Split('.');
                if (parts.Length != 2 || parts[0].Length == 0 || parts[1].Length == 0) { error = "Неверный формат ключа"; return false; }
                var payload = FromB64Url(parts[0]);
                var sig = FromB64Url(parts[1]);

                using (var rsa = RSA.Create())
                {
                    rsa.ImportParameters(new RSAParameters
                    {
                        Modulus = Convert.FromBase64String(PublicModulusBase64),
                        Exponent = Convert.FromBase64String(PublicExponentBase64),
                    });
                    if (!rsa.VerifyData(payload, sig, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
                    { error = "Ключ недействителен"; return false; }
                }

                var f = Encoding.UTF8.GetString(payload).Split('|'); // продукт | компьютер | email | дата
                if (f.Length != 4 || f[0] != Product) { error = "Ключ выдан для другой программы"; return false; }
                if (!string.Equals(f[1], GetMachineId(), StringComparison.OrdinalIgnoreCase))
                { error = "Ключ выдан для другого компьютера"; return false; }
                email = f[2];
                return true;
            }
            catch (Exception ex)
            {
                error = "Не удалось проверить ключ: " + ex.Message;
                return false;
            }
        }

        /// <summary>true, если на этом компьютере уже сохранён рабочий ключ.</summary>
        public static bool IsActivated(out string email)
        {
            email = null;
            try
            {
                if (!File.Exists(KeyFile)) return false;
                string err;
                return Verify(File.ReadAllText(KeyFile), out email, out err);
            }
            catch { return false; }
        }

        /// <summary>Проверяет введённый ключ и, если он верный, сохраняет его.</summary>
        public static bool Activate(string activationKey, out string error)
        {
            string email;
            if (!Verify(activationKey, out email, out error)) return false;
            Directory.CreateDirectory(Path.GetDirectoryName(KeyFile));
            File.WriteAllText(KeyFile, activationKey.Trim());
            return true;
        }

        static byte[] FromB64Url(string s)
        {
            s = s.Replace('-', '+').Replace('_', '/');
            switch (s.Length % 4) { case 2: s += "=="; break; case 3: s += "="; break; }
            return Convert.FromBase64String(s);
        }
    }
}
