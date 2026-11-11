// Окно активации «Печати по слоям» + проверка при запуске. Компилируется вместе с программой
// (см. Build.ps1), использует BrandTheme из Theme.cs для единого оформления.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using SpdsPdf;

namespace PSDPRO.LayerPrint
{
    public static class ActivationGate
    {
        public const string SiteUrl = "https://mdr-khaki-five.vercel.app/";

        /// <summary>true — программа активирована (или пользователь только что ввёл верный ключ).</summary>
        public static bool Ensure(bool interactive)
        {
            string email;
            if (LayerPrintActivation.IsActivated(out email)) return true;
            if (!interactive)
            {
                Console.Error.WriteLine("Программа не активирована. Код компьютера: " + LayerPrintActivation.GetMachineId()
                    + ". Получите ключ на сайте МДР (вкладка «Материалы») и запустите программу без параметров.");
                return false;
            }
            using (var f = new ActivationForm()) return f.ShowDialog() == DialogResult.OK;
        }
    }

    sealed class ActivationForm : Form
    {
        readonly TextBox keyBox;
        readonly Label error;

        public ActivationForm()
        {
            Text = "Печать по слоям — активация";
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen; ClientSize = new Size(540, 400);
            Font = new Font("Segoe UI", 9.5f);

            Controls.Add(new Label { Text = "Активация программы", AutoSize = true, Location = new Point(20, 16), Font = new Font("Segoe UI Semibold", 15) });
            Controls.Add(new Label
            {
                Text = "1. Скопируйте код компьютера и откройте сайт МДР.\n"
                     + "2. Во вкладке «Материалы» вставьте код и нажмите «Получить ключ».\n"
                     + "3. Вставьте полученный ключ ниже и нажмите «Активировать».",
                AutoSize = false, Size = new Size(500, 66), Location = new Point(20, 56),
            });

            Controls.Add(new Label { Text = "Код компьютера", AutoSize = true, Location = new Point(20, 132) });
            var machine = new TextBox { Text = LayerPrintActivation.GetMachineId(), ReadOnly = true, Location = new Point(20, 154), Size = new Size(280, 26), Font = new Font("Consolas", 11) };
            Controls.Add(machine);
            var copy = MakeButton("Копировать", new Point(310, 152), 100, false);
            copy.Click += delegate { try { Clipboard.SetText(machine.Text); copy.Text = "Скопировано ✓"; } catch { } };
            Controls.Add(copy);
            var site = MakeButton("Открыть сайт МДР", new Point(20, 190), 170, false);
            site.Click += delegate
            {
                try { Process.Start(new ProcessStartInfo(ActivationGate.SiteUrl) { UseShellExecute = true }); }
                catch (Exception ex) { MessageBox.Show(this, "Не удалось открыть сайт:\n" + ActivationGate.SiteUrl + "\n\n" + ex.Message, Text); }
            };
            Controls.Add(site);

            Controls.Add(new Label { Text = "Ключ активации", AutoSize = true, Location = new Point(20, 240) });
            keyBox = new TextBox { Multiline = true, ScrollBars = ScrollBars.Vertical, Location = new Point(20, 262), Size = new Size(500, 66), Font = new Font("Consolas", 9) };
            Controls.Add(keyBox);

            error = new Label { AutoSize = false, Size = new Size(500, 20), Location = new Point(20, 334) };
            Controls.Add(error);

            var ok = MakeButton("Активировать", new Point(300, 358), 120, true);
            ok.Click += delegate { Submit(); };
            var close = MakeButton("Закрыть", new Point(430, 358), 90, false);
            close.DialogResult = DialogResult.Cancel;
            Controls.Add(ok); Controls.Add(close);
            AcceptButton = ok; CancelButton = close;

            BrandTheme.Form(this);
            error.ForeColor = BrandTheme.Error;
        }

        Button MakeButton(string text, Point at, int width, bool primary)
        {
            var b = new Button { Text = text, Location = at, Size = new Size(width, 30), FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand };
            b.FlatAppearance.BorderColor = primary ? BrandTheme.Accent : BrandTheme.Border;
            b.BackColor = primary ? BrandTheme.ActionFill : BrandTheme.Raised;
            b.ForeColor = BrandTheme.Text;
            return b;
        }

        void Submit()
        {
            string err;
            if (LayerPrintActivation.Activate(keyBox.Text, out err))
            {
                MessageBox.Show(this, "Программа активирована. Спасибо!", "Печать по слоям", MessageBoxButtons.OK, MessageBoxIcon.Information);
                DialogResult = DialogResult.OK;
            }
            else error.Text = err;
        }
    }
}
