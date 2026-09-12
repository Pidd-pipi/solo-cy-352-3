<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { createMember, deleteMember, rechargeMember, updateMember } from "../../api/booking";
import { bookingState, discountText, levelDiscount, levelName, refreshBookingData } from "../../state/booking";
import type { MemberItem, MemberLevel } from "../../types";

const memberDialog = ref(false);
const rechargeDialog = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);

const memberForm = reactive({
  name: "",
  phone: "",
  level: "normal" as MemberLevel,
});

const rechargeForm = reactive({
  member: null as MemberItem | null,
  amount: 200,
});

const levels = computed(() => bookingState.meta?.levels ?? []);

const txnTypeMap = {
  recharge: { label: "充值", type: "success" as const },
  payment: { label: "消费", type: "danger" as const },
  refund: { label: "退款", type: "warning" as const },
};

function openCreate() {
  editingId.value = null;
  memberForm.name = "";
  memberForm.phone = "";
  memberForm.level = "normal";
  memberDialog.value = true;
}

function openEdit(member: MemberItem) {
  editingId.value = member.id;
  memberForm.name = member.name;
  memberForm.phone = member.phone;
  memberForm.level = member.level;
  memberDialog.value = true;
}

async function submitMember() {
  if (!memberForm.name.trim()) {
    ElMessage.warning("请填写会员姓名");
    return;
  }
  saving.value = true;
  try {
    const payload = { name: memberForm.name.trim(), phone: memberForm.phone.trim(), level: memberForm.level };
    if (editingId.value) {
      await updateMember(editingId.value, payload);
      ElMessage.success(`会员「${payload.name}」已更新`);
    } else {
      await createMember(payload);
      ElMessage.success(`会员「${payload.name}」已注册`);
    }
    memberDialog.value = false;
    await refreshBookingData();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

function openRecharge(member: MemberItem) {
  rechargeForm.member = member;
  rechargeForm.amount = 200;
  rechargeDialog.value = true;
}

async function submitRecharge() {
  const member = rechargeForm.member;
  if (!member) return;
  saving.value = true;
  try {
    const updated = await rechargeMember(member.id, rechargeForm.amount);
    ElMessage.success(`充值成功：「${member.name}」当前余额 ¥${updated.balance.toFixed(2)}`);
    rechargeDialog.value = false;
    await refreshBookingData();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "充值失败");
  } finally {
    saving.value = false;
  }
}

async function remove(member: MemberItem) {
  try {
    await ElMessageBox.confirm(`确定删除会员「${member.name}」吗？`, "删除确认", {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return;
  }
  try {
    await deleteMember(member.id);
    ElMessage.success(`会员「${member.name}」已删除`);
    await refreshBookingData();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "删除失败");
  }
}

function formatTime(iso: string) {
  return iso.replace("T", " ").slice(0, 19);
}
</script>

<template>
  <section>
    <div class="panel-toolbar">
      <p class="panel-hint">会员等级决定预约折扣，充值后即可用余额支付预约，消费自动累计积分。</p>
      <el-button type="primary" @click="openCreate">新增会员</el-button>
    </div>

    <el-table :data="bookingState.members" style="width: 100%" size="large" empty-text="还没有会员，点击右上角新增">
      <el-table-column prop="name" label="姓名" min-width="110" />
      <el-table-column prop="phone" label="手机号" min-width="130">
        <template #default="{ row }">{{ row.phone || "—" }}</template>
      </el-table-column>
      <el-table-column label="等级" width="130" align="center">
        <template #default="{ row }">
          <el-tag :type="row.level === 'normal' ? 'info' : row.level === 'silver' ? 'primary' : row.level === 'gold' ? 'warning' : 'danger'">
            {{ levelName(row.level) }}<template v-if="levelDiscount(row.level) < 1"> {{ discountText(levelDiscount(row.level)) }}折</template><template v-else> 无折扣</template>
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="余额" width="120" align="right">
        <template #default="{ row }">¥{{ row.balance.toFixed(2) }}</template>
      </el-table-column>
      <el-table-column label="积分" width="90" align="right">
        <template #default="{ row }">{{ row.points }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" align="center">
        <template #default="{ row }">
          <el-button link type="success" @click="openRecharge(row)">充值</el-button>
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <h3 class="txn-title">储值流水</h3>
    <el-table :data="bookingState.transactions" style="width: 100%" size="default" empty-text="暂无流水记录" max-height="320">
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column prop="memberName" label="会员" width="100" />
      <el-table-column label="类型" width="80" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="txnTypeMap[row.type as keyof typeof txnTypeMap].type">
            {{ txnTypeMap[row.type as keyof typeof txnTypeMap].label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="金额" width="110" align="right">
        <template #default="{ row }">
          <span :class="row.type === 'payment' ? 'amount-out' : 'amount-in'">
            {{ row.type === "payment" ? "-" : "+" }}¥{{ row.amount.toFixed(2) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="余额" width="110" align="right">
        <template #default="{ row }">¥{{ row.balanceAfter.toFixed(2) }}</template>
      </el-table-column>
      <el-table-column prop="note" label="备注" min-width="220" show-overflow-tooltip />
    </el-table>

    <el-dialog v-model="memberDialog" :title="editingId ? '编辑会员' : '新增会员'" width="440px">
      <el-form label-width="90px">
        <el-form-item label="姓名" required>
          <el-input v-model="memberForm.name" placeholder="会员姓名" maxlength="20" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="memberForm.phone" placeholder="选填" maxlength="11" />
        </el-form-item>
        <el-form-item label="会员等级" required>
          <el-select v-model="memberForm.level" style="width: 100%">
            <el-option v-for="level in levels" :key="level.code" :value="level.code"
              :label="level.discount < 1 ? `${level.name}（${discountText(level.discount)}折）` : `${level.name}（无折扣）`" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="memberDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitMember">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="rechargeDialog" :title="`充值 - ${rechargeForm.member?.name ?? ''}`" width="420px">
      <el-form label-width="90px">
        <el-form-item label="当前余额">
          <span>¥{{ rechargeForm.member?.balance.toFixed(2) }}</span>
        </el-form-item>
        <el-form-item label="充值金额" required>
          <el-input-number v-model="rechargeForm.amount" :min="1" :max="100000" :precision="2" style="width: 180px" />
          <div class="quick-amounts">
            <el-button v-for="amount in [100, 200, 500, 1000]" :key="amount" size="small" @click="rechargeForm.amount = amount">
              ¥{{ amount }}
            </el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rechargeDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitRecharge">确认充值</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.panel-hint {
  margin: 0;
  color: #5b6675;
}

.txn-title {
  margin: 28px 0 12px;
}

.quick-amounts {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.amount-in {
  color: #2e8b57;
  font-weight: 700;
}

.amount-out {
  color: #cf5c36;
  font-weight: 700;
}
</style>
